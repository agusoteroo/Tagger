import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditoria, etiquetas, frascos, maquinas, operarios, turnos } from "@/db/schema";
import { ErrorNegocio } from "./errores";

/**
 * Altas, bajas y modificaciones de los catalogos.
 *
 * Regla general: NADA se borra si ya fue usado en una etiqueta. Se desactiva.
 * Borrar un operario que produjo 300 cajas rompería la trazabilidad de esas
 * cajas. Desactivarlo lo saca de la pantalla de etiquetado y deja el historial
 * intacto.
 */

async function auditar(
  accion: string,
  entidad: string,
  entidadId: number | null,
  actor: string,
  detalle?: unknown
) {
  await db.insert(auditoria).values({
    accion,
    entidad,
    entidadId,
    actor,
    detalle: detalle === undefined ? null : JSON.stringify(detalle),
  });
}

function nombreLimpio(v: unknown, campo: string): string {
  const s = String(v ?? "").trim();
  if (!s) throw new ErrorNegocio(`${campo} no puede estar vacío.`);
  if (s.length > 80) throw new ErrorNegocio(`${campo} es demasiado largo (máx 80).`);
  return s;
}

/**
 * Traduce una violacion de unicidad a un mensaje util.
 *
 * El texto cambio al pasar a Postgres: SQLite decia "UNIQUE constraint failed",
 * Postgres dice "duplicate key value violates unique constraint". Si esto no se
 * hubiera actualizado, el usuario veria un error crudo de la base en vez de
 * "ya existe un operario con ese nombre".
 */
function duplicado(e: unknown, que: string): never {
  const msg = String((e as { message?: string })?.message ?? e);
  const codigo = (e as { code?: string })?.code;
  if (codigo === "23505" || /duplicate key value|unique constraint/i.test(msg)) {
    throw new ErrorNegocio(`Ya existe ${que} con ese nombre.`, 409);
  }
  throw e;
}

/** count(*) en Postgres vuelve como bigint: el ::int evita recibir un string. */
async function cuantasEtiquetas(condicion: ReturnType<typeof eq>) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(etiquetas)
    .where(condicion);
  return r?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Frascos
// ---------------------------------------------------------------------------
export async function crearFrasco(
  input: { nombre: string; cantidadEstandar?: number | null; prefijoLote?: string | null },
  actor: string
) {
  const nombre = nombreLimpio(input.nombre, "El nombre del frasco");
  const cant = input.cantidadEstandar;
  if (cant !== null && cant !== undefined && (!Number.isInteger(cant) || cant <= 0)) {
    throw new ErrorNegocio("La cantidad estándar tiene que ser un entero mayor a cero.");
  }
  try {
    const [f] = await db
      .insert(frascos)
      .values({
        nombre,
        cantidadEstandar: cant ?? null,
        prefijoLote: input.prefijoLote?.trim() || null,
      })
      .returning();
    await auditar("frasco.crear", "frasco", f.id, actor, { nombre, cantidadEstandar: cant ?? null });
    return f;
  } catch (e) {
    duplicado(e, "un frasco");
  }
}

export async function editarFrasco(
  id: number,
  input: {
    nombre?: string;
    cantidadEstandar?: number | null;
    prefijoLote?: string | null;
    activo?: boolean;
  },
  actor: string
) {
  const [actual] = await db.select().from(frascos).where(eq(frascos.id, id));
  if (!actual) throw new ErrorNegocio("El frasco no existe.", 404);

  const cambios: Partial<typeof actual> = {};
  if (input.nombre !== undefined) cambios.nombre = nombreLimpio(input.nombre, "El nombre del frasco");
  if (input.cantidadEstandar !== undefined) {
    const c = input.cantidadEstandar;
    if (c !== null && (!Number.isInteger(c) || c <= 0)) {
      throw new ErrorNegocio("La cantidad estándar tiene que ser un entero mayor a cero.");
    }
    cambios.cantidadEstandar = c;
  }
  if (input.prefijoLote !== undefined) cambios.prefijoLote = input.prefijoLote?.trim() || null;
  if (input.activo !== undefined) cambios.activo = input.activo;
  if (!Object.keys(cambios).length) return actual;

  try {
    const [f] = await db.update(frascos).set(cambios).where(eq(frascos.id, id)).returning();
    await auditar("frasco.editar", "frasco", id, actor, { antes: actual, despues: f });
    return f;
  } catch (e) {
    duplicado(e, "un frasco");
  }
}

// ---------------------------------------------------------------------------
// Operarios
// ---------------------------------------------------------------------------
export async function crearOperario(nombre: string, actor: string) {
  const n = nombreLimpio(nombre, "El nombre del operario");
  try {
    const [o] = await db.insert(operarios).values({ nombre: n }).returning();
    await auditar("operario.crear", "operario", o.id, actor, { nombre: n });
    return o;
  } catch (e) {
    duplicado(e, "un operario");
  }
}

export async function editarOperario(
  id: number,
  input: { nombre?: string; activo?: boolean },
  actor: string
) {
  const [actual] = await db.select().from(operarios).where(eq(operarios.id, id));
  if (!actual) throw new ErrorNegocio("El operario no existe.", 404);

  const cambios: { nombre?: string; activo?: boolean } = {};
  if (input.nombre !== undefined)
    cambios.nombre = nombreLimpio(input.nombre, "El nombre del operario");
  if (input.activo !== undefined) cambios.activo = input.activo;
  if (!Object.keys(cambios).length) return actual;

  try {
    const [o] = await db.update(operarios).set(cambios).where(eq(operarios.id, id)).returning();
    await auditar("operario.editar", "operario", id, actor, { antes: actual, despues: o });
    return o;
  } catch (e) {
    duplicado(e, "un operario");
  }
}

/**
 * Baja de operario. Si ya produjo etiquetas NO se borra: se desactiva, para no
 * romper la trazabilidad de esas cajas.
 */
export async function bajaOperario(id: number, actor: string) {
  const [actual] = await db.select().from(operarios).where(eq(operarios.id, id));
  if (!actual) throw new ErrorNegocio("El operario no existe.", 404);

  const usado = await cuantasEtiquetas(eq(etiquetas.operarioId, id));

  if (usado > 0) {
    const [o] = await db
      .update(operarios)
      .set({ activo: false })
      .where(eq(operarios.id, id))
      .returning();
    await auditar("operario.desactivar", "operario", id, actor, {
      nombre: actual.nombre,
      etiquetas: usado,
    });
    return { accion: "desactivado" as const, operario: o, etiquetas: usado };
  }

  await db.delete(operarios).where(eq(operarios.id, id));
  await auditar("operario.borrar", "operario", id, actor, { nombre: actual.nombre });
  return { accion: "borrado" as const, operario: actual, etiquetas: 0 };
}

// ---------------------------------------------------------------------------
// Turnos
// ---------------------------------------------------------------------------
export async function crearTurno(nombre: string, actor: string) {
  const n = nombreLimpio(nombre, "El nombre del turno");
  const [fila] = await db
    .select({ m: sql<number>`coalesce(max(${turnos.orden}), -1)::int` })
    .from(turnos);
  try {
    const [t] = await db
      .insert(turnos)
      .values({ nombre: n, orden: (fila?.m ?? -1) + 1 })
      .returning();
    await auditar("turno.crear", "turno", t.id, actor, { nombre: n });
    return t;
  } catch (e) {
    duplicado(e, "un turno");
  }
}

export async function bajaTurno(id: number, actor: string) {
  const [actual] = await db.select().from(turnos).where(eq(turnos.id, id));
  if (!actual) throw new ErrorNegocio("El turno no existe.", 404);

  const usado = await cuantasEtiquetas(eq(etiquetas.turno, actual.nombre));

  if (usado > 0) {
    const [t] = await db.update(turnos).set({ activo: false }).where(eq(turnos.id, id)).returning();
    await auditar("turno.desactivar", "turno", id, actor, {
      nombre: actual.nombre,
      etiquetas: usado,
    });
    return { accion: "desactivado" as const, turno: t, etiquetas: usado };
  }
  await db.delete(turnos).where(eq(turnos.id, id));
  await auditar("turno.borrar", "turno", id, actor, { nombre: actual.nombre });
  return { accion: "borrado" as const, turno: actual, etiquetas: 0 };
}

// ---------------------------------------------------------------------------
// Maquinas
// ---------------------------------------------------------------------------
export async function crearMaquina(input: { nombre: string; frascoId: number }, actor: string) {
  const nombre = nombreLimpio(input.nombre, "El nombre de la máquina");
  const [frasco] = await db.select().from(frascos).where(eq(frascos.id, input.frascoId));
  if (!frasco) throw new ErrorNegocio("El frasco elegido no existe.", 404);
  try {
    const [m] = await db.insert(maquinas).values({ nombre, frascoId: frasco.id }).returning();
    await auditar("maquina.crear", "maquina", m.id, actor, { nombre, frasco: frasco.nombre });
    return m;
  } catch (e) {
    duplicado(e, "una máquina");
  }
}

export async function editarMaquina(
  id: number,
  input: { nombre?: string; frascoId?: number; activa?: boolean },
  actor: string
) {
  const [actual] = await db.select().from(maquinas).where(eq(maquinas.id, id));
  if (!actual) throw new ErrorNegocio("La máquina no existe.", 404);

  const cambios: { nombre?: string; frascoId?: number; activa?: boolean } = {};
  if (input.nombre !== undefined)
    cambios.nombre = nombreLimpio(input.nombre, "El nombre de la máquina");
  if (input.frascoId !== undefined) {
    const [f] = await db.select().from(frascos).where(eq(frascos.id, input.frascoId));
    if (!f) throw new ErrorNegocio("El frasco elegido no existe.", 404);
    // Cambiar el frasco con un lote abierto mezclaria dos productos en el mismo
    // lote. Eso se hace al abrir un lote nuevo, no aca.
    if (actual.loteActualId && input.frascoId !== actual.frascoId) {
      throw new ErrorNegocio(
        "No se puede cambiar el producto con un lote abierto. Se cambia al abrir el lote siguiente.",
        409
      );
    }
    cambios.frascoId = f.id;
  }
  if (input.activa !== undefined) cambios.activa = input.activa;
  if (!Object.keys(cambios).length) return actual;

  try {
    const [m] = await db.update(maquinas).set(cambios).where(eq(maquinas.id, id)).returning();
    await auditar("maquina.editar", "maquina", id, actor, { antes: actual, despues: m });
    return m;
  } catch (e) {
    duplicado(e, "una máquina");
  }
}

export async function bajaMaquina(id: number, actor: string) {
  const [actual] = await db.select().from(maquinas).where(eq(maquinas.id, id));
  if (!actual) throw new ErrorNegocio("La máquina no existe.", 404);
  // Las maquinas siempre se desactivan: sus lotes y etiquetas la referencian.
  const [m] = await db.update(maquinas).set({ activa: false }).where(eq(maquinas.id, id)).returning();
  await auditar("maquina.desactivar", "maquina", id, actor, { nombre: actual.nombre });
  return m;
}
