import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditoria, etiquetas, frascos, lotes, maquinas } from "@/db/schema";
import { ErrorNegocio } from "./errores";
import { conReintentoUnico } from "./reintento";

export type Unidad = "cajas" | "unidades";
export type EstadoLote = "preparado" | "abierto" | "cerrado";

/** El `tx` que pasa drizzle dentro de una transaccion. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Sirve tanto `db` como un `tx`: las consultas de lectura aceptan los dos. */
type Ejecutor = Pick<typeof db, "select" | "insert" | "update" | "delete">;

async function auditar(
  tx: Ejecutor,
  accion: string,
  id: number | null,
  actor: string | null,
  detalle?: unknown
) {
  await tx.insert(auditoria).values({
    accion,
    entidad: "lote",
    entidadId: id,
    actor,
    detalle: detalle === undefined ? null : JSON.stringify(detalle),
  });
}

/** Cuanto lleva producido un lote. Las anuladas NO cuentan: la caja no sirve. */
export async function progreso(loteId: number, tx: Ejecutor = db) {
  const [r] = await tx
    .select({
      cajas: sql<number>`count(*)::int`,
      unidades: sql<number>`coalesce(sum(${etiquetas.cantidad}), 0)::int`,
    })
    .from(etiquetas)
    .where(and(eq(etiquetas.loteId, loteId), eq(etiquetas.anulada, false)));
  return { cajas: r?.cajas ?? 0, unidades: r?.unidades ?? 0 };
}

/** Si ya alcanzo o paso el limite. */
export function limiteAlcanzado(
  lote: { limite: number; limiteUnidad: string },
  p: { cajas: number; unidades: number }
) {
  const hecho = lote.limiteUnidad === "cajas" ? p.cajas : p.unidades;
  return hecho >= lote.limite;
}

function codigoDe(prefijo: string | null, numero: number) {
  return prefijo?.trim() ? `${prefijo.trim()}-${numero}` : String(numero);
}

// ---------------------------------------------------------------------------
// Preparar un lote (el formulario del jefe de planta)
// ---------------------------------------------------------------------------

/**
 * Crea un lote y le reserva el numero. El numero es secuencial POR FRASCO y se
 * reserva ahora, no al activarlo: si dos maquinas hacen el mismo producto, la
 * segunda toma el numero siguiente y nunca colisionan.
 *
 * Si la maquina no tiene lote abierto, este arranca ya. Si tiene, queda en cola.
 */
export async function prepararLote(input: {
  maquinaId: number;
  frascoId?: number;
  limite: number;
  limiteUnidad: Unidad;
  nota?: string;
  actor: string;
}) {
  if (!Number.isInteger(input.limite) || input.limite <= 0) {
    throw new ErrorNegocio("El límite tiene que ser un número entero mayor a cero.");
  }
  if (input.limiteUnidad !== "cajas" && input.limiteUnidad !== "unidades") {
    throw new ErrorNegocio("La unidad del límite tiene que ser 'cajas' o 'unidades'.");
  }

  // El reintento cubre el caso de que dos lotes del mismo producto se creen a
  // la vez: la restriccion UNIQUE(frasco, numero) rechaza uno y se reintenta.
  return conReintentoUnico(
    () =>
      db.transaction(async (tx) => {
        const [maq] = await tx.select().from(maquinas).where(eq(maquinas.id, input.maquinaId));
        if (!maq) throw new ErrorNegocio("La máquina no existe.", 404);
        if (!maq.activa) throw new ErrorNegocio(`La máquina ${maq.nombre} está inactiva.`);

        const frascoId = input.frascoId ?? maq.frascoId;
        if (!frascoId) throw new ErrorNegocio("Hay que indicar qué producto va a hacer este lote.");

        const [frasco] = await tx.select().from(frascos).where(eq(frascos.id, frascoId));
        if (!frasco) throw new ErrorNegocio("El producto elegido no existe.", 404);

        // ¿Hay un lote abierto en esta maquina? Si no, este arranca ya.
        const [abierto] = await tx
          .select({ id: lotes.id })
          .from(lotes)
          .where(and(eq(lotes.maquinaId, maq.id), eq(lotes.estado, "abierto")));
        const arrancaYa = !abierto;

        // Numero siguiente de la secuencia de ESTE producto.
        const [fila] = await tx
          .select({ prox: sql<number>`(coalesce(max(${lotes.numero}), 0) + 1)::int` })
          .from(lotes)
          .where(eq(lotes.frascoId, frasco.id));
        const numero = fila?.prox ?? 1;

        const [lote] = await tx
          .insert(lotes)
          .values({
            numero,
            codigo: codigoDe(frasco.prefijoLote, numero),
            maquinaId: maq.id,
            frascoId: frasco.id,
            maquinaNombre: maq.nombre,
            frascoNombre: frasco.nombre,
            limite: input.limite,
            limiteUnidad: input.limiteUnidad,
            estado: arrancaYa ? "abierto" : "preparado",
            preparadoPor: input.actor,
            abiertoEn: arrancaYa ? sql`now()` : null,
            nota: input.nota?.trim() || null,
          })
          .returning();

        if (arrancaYa) {
          // Abrir un lote de otro producto es tambien el momento natural para
          // cambiar lo que produce la maquina.
          await tx
            .update(maquinas)
            .set({ loteActualId: lote.id, frascoId: frasco.id })
            .where(eq(maquinas.id, maq.id));
        }

        await auditar(tx, arrancaYa ? "lote.abrir" : "lote.preparar", lote.id, input.actor, {
          numero,
          codigo: lote.codigo,
          maquina: maq.nombre,
          frasco: frasco.nombre,
          limite: input.limite,
          unidad: input.limiteUnidad,
        });

        return { lote, arrancoYa: arrancaYa };
      }),
    { que: "el lote" }
  );
}

// ---------------------------------------------------------------------------
// Cierre y activacion del siguiente
// ---------------------------------------------------------------------------

/**
 * Cierra el lote abierto de una maquina y activa el siguiente de la cola.
 * Se usa desde crearEtiqueta (cierre por limite) y desde el cierre manual.
 *
 * Devuelve el lote que quedo abierto, o null si la cola estaba vacia (ahi la
 * maquina queda sin lote y no puede etiquetar hasta que el jefe cargue otro).
 */
export async function cerrarYAvanzarEnTx(
  tx: Tx,
  lote: { id: number; maquinaId: number; codigo: string },
  motivo: "limite" | "manual",
  actor: string | null
) {
  await tx
    .update(lotes)
    .set({ estado: "cerrado", cerradoEn: sql`now()`, cerradoMotivo: motivo, cerradoPor: actor })
    .where(eq(lotes.id, lote.id));

  const p = await progreso(lote.id, tx);
  await auditar(tx, "lote.cerrar", lote.id, actor, { motivo, codigo: lote.codigo, ...p });

  // El siguiente de la cola: el preparado mas viejo de esta maquina.
  const [siguiente] = await tx
    .select()
    .from(lotes)
    .where(and(eq(lotes.maquinaId, lote.maquinaId), eq(lotes.estado, "preparado")))
    .orderBy(asc(lotes.preparadoEn), asc(lotes.id))
    .limit(1);

  if (!siguiente) {
    await tx.update(maquinas).set({ loteActualId: null }).where(eq(maquinas.id, lote.maquinaId));
    return null;
  }

  await tx
    .update(lotes)
    .set({ estado: "abierto", abiertoEn: sql`now()` })
    .where(eq(lotes.id, siguiente.id));
  await tx
    .update(maquinas)
    .set({ loteActualId: siguiente.id, frascoId: siguiente.frascoId })
    .where(eq(maquinas.id, lote.maquinaId));

  await auditar(tx, "lote.abrir", siguiente.id, "sistema", {
    codigo: siguiente.codigo,
    motivo: "arrancó automáticamente al cerrarse el anterior",
    anterior: lote.codigo,
  });

  return siguiente;
}

/** Cierre manual: el jefe corta el lote antes de llegar al limite. */
export async function cerrarLoteManual(input: { loteId: number; actor: string }) {
  return db.transaction(async (tx) => {
    const [lote] = await tx.select().from(lotes).where(eq(lotes.id, input.loteId));
    if (!lote) throw new ErrorNegocio("El lote no existe.", 404);
    if (lote.estado === "cerrado") throw new ErrorNegocio("El lote ya está cerrado.");
    if (lote.estado === "preparado") {
      throw new ErrorNegocio(
        "Ese lote todavía no arrancó. Si no lo vas a usar, cancelalo en vez de cerrarlo."
      );
    }
    const siguiente = await cerrarYAvanzarEnTx(tx, lote, "manual", input.actor);
    return { cerrado: lote.codigo, siguiente: siguiente?.codigo ?? null };
  });
}

/**
 * Cancelar un lote preparado que todavia no arranco.
 * No se borra: queda cerrado con motivo 'cancelado', asi el hueco en la
 * numeracion queda explicado.
 */
export async function cancelarLotePreparado(input: { loteId: number; actor: string }) {
  return db.transaction(async (tx) => {
    const [lote] = await tx.select().from(lotes).where(eq(lotes.id, input.loteId));
    if (!lote) throw new ErrorNegocio("El lote no existe.", 404);
    if (lote.estado !== "preparado") {
      throw new ErrorNegocio("Solo se pueden cancelar lotes que todavía no arrancaron.");
    }
    await tx
      .update(lotes)
      .set({
        estado: "cerrado",
        cerradoEn: sql`now()`,
        cerradoMotivo: "cancelado",
        cerradoPor: input.actor,
      })
      .where(eq(lotes.id, lote.id));
    await auditar(tx, "lote.cancelar", lote.id, input.actor, { codigo: lote.codigo });
    // El numero NO se reusa: el hueco es la evidencia de que existio.
    return { cancelado: lote.codigo };
  });
}

/** Editar el limite de un lote abierto o preparado (el jefe se equivoco). */
export async function editarLimite(input: {
  loteId: number;
  limite: number;
  limiteUnidad: Unidad;
  actor: string;
}) {
  if (!Number.isInteger(input.limite) || input.limite <= 0) {
    throw new ErrorNegocio("El límite tiene que ser un número entero mayor a cero.");
  }
  return db.transaction(async (tx) => {
    const [lote] = await tx.select().from(lotes).where(eq(lotes.id, input.loteId));
    if (!lote) throw new ErrorNegocio("El lote no existe.", 404);
    if (lote.estado === "cerrado") throw new ErrorNegocio("El lote ya está cerrado.");

    await tx
      .update(lotes)
      .set({ limite: input.limite, limiteUnidad: input.limiteUnidad })
      .where(eq(lotes.id, lote.id));
    await auditar(tx, "lote.editarLimite", lote.id, input.actor, {
      codigo: lote.codigo,
      antes: { limite: lote.limite, unidad: lote.limiteUnidad },
      despues: { limite: input.limite, unidad: input.limiteUnidad },
    });

    // Si el limite nuevo ya quedo alcanzado, cerrar en el acto.
    const p = await progreso(lote.id, tx);
    if (
      lote.estado === "abierto" &&
      limiteAlcanzado({ limite: input.limite, limiteUnidad: input.limiteUnidad }, p)
    ) {
      const sig = await cerrarYAvanzarEnTx(tx, lote, "limite", input.actor);
      return { ajustado: true, cerrado: true, siguiente: sig?.codigo ?? null };
    }
    return { ajustado: true, cerrado: false, siguiente: null };
  });
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export async function listarLotes(
  f: { estado?: EstadoLote; maquinaId?: number; limit?: number } = {}
) {
  const cond = [];
  if (f.estado) cond.push(eq(lotes.estado, f.estado));
  if (f.maquinaId) cond.push(eq(lotes.maquinaId, f.maquinaId));

  // El progreso se calcula en la misma consulta con un subselect, no con una
  // consulta por lote. Contra una base remota, N+1 se paga en latencia de red.
  const filas = await db
    .select({
      id: lotes.id,
      numero: lotes.numero,
      codigo: lotes.codigo,
      maquinaId: lotes.maquinaId,
      frascoId: lotes.frascoId,
      maquinaNombre: lotes.maquinaNombre,
      frascoNombre: lotes.frascoNombre,
      limite: lotes.limite,
      limiteUnidad: lotes.limiteUnidad,
      estado: lotes.estado,
      preparadoPor: lotes.preparadoPor,
      preparadoEn: lotes.preparadoEn,
      abiertoEn: lotes.abiertoEn,
      cerradoEn: lotes.cerradoEn,
      cerradoMotivo: lotes.cerradoMotivo,
      cerradoPor: lotes.cerradoPor,
      nota: lotes.nota,
      progresoCajas: sql<number>`(
        select count(*)::int from ${etiquetas}
        where ${etiquetas.loteId} = ${lotes.id} and ${etiquetas.anulada} = false
      )`,
      progresoUnidades: sql<number>`(
        select coalesce(sum(${etiquetas.cantidad}), 0)::int from ${etiquetas}
        where ${etiquetas.loteId} = ${lotes.id} and ${etiquetas.anulada} = false
      )`,
    })
    .from(lotes)
    .where(cond.length ? and(...cond) : undefined)
    // Abiertos primero, despues preparados, despues cerrados por fecha.
    .orderBy(
      sql`case ${lotes.estado} when 'abierto' then 0 when 'preparado' then 1 else 2 end`,
      desc(lotes.preparadoEn),
      desc(lotes.id)
    )
    .limit(Math.min(f.limit ?? 200, 1000));

  return filas.map((l) => {
    const hecho = l.limiteUnidad === "cajas" ? l.progresoCajas : l.progresoUnidades;
    return {
      ...l,
      hecho,
      // Puede pasar de 100: la caja que cruza el limite se etiqueta igual.
      porcentaje: l.limite > 0 ? Math.round((hecho / l.limite) * 100) : 0,
      restante: Math.max(0, l.limite - hecho),
      excedente: Math.max(0, hecho - l.limite),
    };
  });
}

export type LoteConProgreso = Awaited<ReturnType<typeof listarLotes>>[number];

/** Cuantos lotes esperan en la cola de cada maquina. */
export async function colaPorMaquina() {
  const filas = await db
    .select({ maquinaId: lotes.maquinaId, n: sql<number>`count(*)::int` })
    .from(lotes)
    .where(eq(lotes.estado, "preparado"))
    .groupBy(lotes.maquinaId);
  return new Map(filas.map((f) => [f.maquinaId, f.n]));
}
