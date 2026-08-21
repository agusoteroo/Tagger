import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditoria, etiquetas, lotes, maquinas, operarios } from "@/db/schema";
import { ErrorNegocio } from "./errores";
import { condiciones, type Filtros } from "./filtros";
import { cerrarYAvanzarEnTx, limiteAlcanzado, progreso, type Tx } from "./lotes";
import { conReintentoUnico } from "./reintento";
import { diaLocal, hoyLocal } from "./tiempo";

export { ErrorNegocio };

type Ejecutor = Pick<typeof db, "select" | "insert" | "update" | "delete">;

async function auditar(
  tx: Ejecutor,
  accion: string,
  entidad: string,
  entidadId: number | null,
  actor: string | null,
  detalle?: unknown
) {
  await tx.insert(auditoria).values({
    accion,
    entidad,
    entidadId,
    actor,
    detalle: detalle === undefined ? null : JSON.stringify(detalle),
  });
}

// ---------------------------------------------------------------------------
// Crear etiqueta. ESTA es la funcion que impide dos cajas con el mismo numero.
//
// En SQLite la defensa era `BEGIN IMMEDIATE`: tomaba el lock de escritura antes
// de leer MAX(caja). Postgres no tiene eso, asi que la defensa es la otra que ya
// existia, y que era la de verdad importante:
//
//   UNIQUE(lote_id, caja) + reintento
//
// La restriccion garantiza que el duplicado sea IMPOSIBLE de guardar. El
// reintento hace que, cuando la restriccion rechaza, el operario no vea un
// error: se vuelve a intentar con el numero siguiente.
//
// Con un solo puesto etiquetando esto no se ejecuta nunca. Esta igual porque el
// dia que agreguen un segundo puesto, nadie se va a acordar de este detalle.
// ---------------------------------------------------------------------------
export async function crearEtiqueta(input: {
  maquinaId: number;
  operarioId: number;
  turno: string;
  cantidad: number;
  actor?: string;
}) {
  if (!Number.isInteger(input.cantidad) || input.cantidad <= 0) {
    throw new ErrorNegocio("La cantidad tiene que ser un entero mayor a cero.");
  }
  if (!input.turno?.trim()) throw new ErrorNegocio("Falta el turno.");

  return conReintentoUnico(
    () =>
      db.transaction(async (tx) => {
        const [maq] = await tx.select().from(maquinas).where(eq(maquinas.id, input.maquinaId));
        if (!maq) throw new ErrorNegocio("La máquina no existe.", 404);
        if (!maq.activa) throw new ErrorNegocio(`La máquina ${maq.nombre} está inactiva.`);
        if (!maq.loteActualId) {
          // El operario no puede abrir lotes: eso lo hace el jefe de planta. El
          // mensaje tiene que decirle a quién buscar, no pedirle algo que no puede.
          throw new ErrorNegocio(
            `${maq.nombre} no tiene un lote abierto. Avisale al jefe de planta para que abra el siguiente.`
          );
        }

        const [lote] = await tx.select().from(lotes).where(eq(lotes.id, maq.loteActualId));
        if (!lote) throw new ErrorNegocio("El lote de la máquina no existe.", 404);
        if (lote.estado !== "abierto") {
          throw new ErrorNegocio(
            `El lote ${lote.codigo} ya está cerrado. Necesitás que el jefe de planta abra el siguiente.`
          );
        }

        const [op] = await tx.select().from(operarios).where(eq(operarios.id, input.operarioId));
        if (!op) throw new ErrorNegocio("El operario no existe.", 404);

        // Numero de caja siguiente. Las anuladas SI ocupan numero: el hueco en
        // la secuencia es la evidencia de que ahi hubo una caja.
        const [fila] = await tx
          .select({ prox: sql<number>`(coalesce(max(${etiquetas.caja}), 0) + 1)::int` })
          .from(etiquetas)
          .where(eq(etiquetas.loteId, lote.id));
        const caja = fila?.prox ?? 1;

        const [et] = await tx
          .insert(etiquetas)
          .values({
            loteId: lote.id,
            caja,
            cantidad: input.cantidad,
            operarioId: op.id,
            loteCodigo: lote.codigo,
            maquinaNombre: lote.maquinaNombre,
            frascoNombre: lote.frascoNombre,
            operarioNombre: op.nombre,
            turno: input.turno.trim(),
          })
          .returning();

        await auditar(tx, "etiqueta.crear", "etiqueta", et.id, input.actor ?? op.nombre, {
          lote: lote.codigo,
          caja,
          cantidad: input.cantidad,
        });

        // -------------------------------------------------------------------
        // Limite del lote.
        //
        // El chequeo va DESPUES de insertar, a proposito: la caja que cruza el
        // limite ya existe fisicamente en la planta, asi que se etiqueta igual.
        // Rechazarla dejaria producto real sin registrar, que es peor que
        // pasarse del limite por una caja. El excedente queda visible.
        // -------------------------------------------------------------------
        const p = await progreso(lote.id, tx);
        let loteCerrado: string | null = null;
        let loteSiguiente: string | null = null;

        if (limiteAlcanzado(lote, p)) {
          const sig = await cerrarYAvanzarEnTx(tx as Tx, lote, "limite", "sistema");
          loteCerrado = lote.codigo;
          loteSiguiente = sig?.codigo ?? null;
        }

        return {
          ...et,
          // Con esto la pantalla puede avisarle al operario que cambio el lote.
          lote: {
            codigo: lote.codigo,
            limite: lote.limite,
            limiteUnidad: lote.limiteUnidad,
            hecho: lote.limiteUnidad === "cajas" ? p.cajas : p.unidades,
            cerrado: loteCerrado,
            siguiente: loteSiguiente,
          },
        };
      }),
    { que: "la caja" }
  );
}

// ---------------------------------------------------------------------------
// Calidad: liberar o rechazar. No modifica la etiqueta, le agrega el dictamen.
// ---------------------------------------------------------------------------
export async function resolverCalidad(input: {
  etiquetaIds: number[];
  estado: "liberada" | "rechazada";
  por: string;
  nota?: string;
}) {
  if (!input.etiquetaIds.length) throw new ErrorNegocio("No se seleccionó ninguna etiqueta.");
  if (!input.por?.trim()) throw new ErrorNegocio("Falta el responsable de calidad.");

  return db.transaction(async (tx) => {
    const afectadas: number[] = [];
    for (const id of input.etiquetaIds) {
      const [et] = await tx.select().from(etiquetas).where(eq(etiquetas.id, id));
      if (!et) throw new ErrorNegocio(`La etiqueta ${id} no existe.`, 404);
      if (et.anulada) throw new ErrorNegocio(`La etiqueta ${id} está anulada.`);

      await tx
        .update(etiquetas)
        .set({
          estadoCalidad: input.estado,
          calidadPor: input.por.trim(),
          calidadEn: sql`now()`,
          calidadNota: input.nota?.trim() || null,
        })
        .where(eq(etiquetas.id, id));

      await auditar(tx, `etiqueta.${input.estado}`, "etiqueta", id, input.por, {
        antes: et.estadoCalidad,
        despues: input.estado,
        nota: input.nota ?? null,
      });
      afectadas.push(id);
    }
    return { afectadas };
  });
}

// ---------------------------------------------------------------------------
// Anular: el reemplazo del DELETE. La fila queda, marcada y auditada.
// ---------------------------------------------------------------------------
export async function anularEtiqueta(input: {
  etiquetaId: number;
  por: string;
  motivo: string;
}) {
  if (!input.motivo?.trim()) throw new ErrorNegocio("Hay que indicar el motivo de la anulación.");

  return db.transaction(async (tx) => {
    const [et] = await tx.select().from(etiquetas).where(eq(etiquetas.id, input.etiquetaId));
    if (!et) throw new ErrorNegocio("La etiqueta no existe.", 404);
    if (et.anulada) throw new ErrorNegocio("La etiqueta ya estaba anulada.");

    await tx
      .update(etiquetas)
      .set({
        anulada: true,
        anuladaPor: input.por.trim(),
        anuladaMotivo: input.motivo.trim(),
        anuladaEn: sql`now()`,
      })
      .where(eq(etiquetas.id, input.etiquetaId));

    await auditar(tx, "etiqueta.anular", "etiqueta", et.id, input.por, {
      lote: et.loteCodigo,
      caja: et.caja,
      motivo: input.motivo,
    });

    // Ojo: NO se reusa el numero de caja. El hueco queda a proposito, porque
    // es la evidencia de que ahi hubo una caja y se anulo.
    return { ...et, anulada: true };
  });
}

export async function registrarImpresion(etiquetaId: number, actor?: string) {
  return db.transaction(async (tx) => {
    const [et] = await tx.select().from(etiquetas).where(eq(etiquetas.id, etiquetaId));
    if (!et) throw new ErrorNegocio("La etiqueta no existe.", 404);

    await tx
      .update(etiquetas)
      .set({ impresiones: et.impresiones + 1, ultimaImpresionEn: sql`now()` })
      .where(eq(etiquetas.id, etiquetaId));

    // Solo se audita la REimpresion: la primera es parte del flujo normal.
    if (et.impresiones > 0) {
      await auditar(tx, "etiqueta.reimprimir", "etiqueta", et.id, actor ?? null, {
        lote: et.loteCodigo,
        caja: et.caja,
        impresionNro: et.impresiones + 1,
      });
    }
    return { ...et, impresiones: et.impresiones + 1 };
  });
}

// ---------------------------------------------------------------------------
// Consultas: esto es lo que alimenta el historial y los dashboards.
// ---------------------------------------------------------------------------
export async function listarEtiquetas(f: Filtros & { limit?: number; offset?: number }) {
  // Misma condicion WHERE que usan las metricas, el export y el reporte: si
  // divergieran, el Excel no coincidiria con lo que se ve en pantalla.
  const where = condiciones(f);

  const limit = Math.min(Math.max(f.limit ?? 200, 1), 1000);
  const offset = Math.max(f.offset ?? 0, 0);

  // Total, suma y pagina en un solo viaje: contra una base remota, tres
  // consultas separadas son tres veces la latencia de red.
  const [resumenFila] = await db
    .select({
      total: sql<number>`count(*)::int`,
      unidades: sql<number>`coalesce(sum(${etiquetas.cantidad}), 0)::int`,
    })
    .from(etiquetas)
    .where(where);

  const filas = await db
    .select()
    .from(etiquetas)
    .where(where)
    .orderBy(desc(etiquetas.creadoEn), desc(etiquetas.id))
    .limit(limit)
    .offset(offset);

  return {
    filas,
    total: resumenFila?.total ?? 0,
    unidades: resumenFila?.unidades ?? 0,
    limit,
    offset,
  };
}

/** Filas completas sin paginar, para el export. Tope duro por seguridad. */
export async function etiquetasParaExport(f: Filtros, tope = 50_000) {
  return db
    .select()
    .from(etiquetas)
    .where(condiciones(f))
    .orderBy(desc(etiquetas.creadoEn), desc(etiquetas.id))
    .limit(tope);
}

export async function resumen() {
  const porEstado = await db
    .select({ estado: etiquetas.estadoCalidad, n: sql<number>`count(*)::int` })
    .from(etiquetas)
    .where(eq(etiquetas.anulada, false))
    .groupBy(etiquetas.estadoCalidad);

  const [hoy] = await db
    .select({
      cajas: sql<number>`count(*)::int`,
      unidades: sql<number>`coalesce(sum(${etiquetas.cantidad}), 0)::int`,
    })
    .from(etiquetas)
    .where(
      and(
        eq(etiquetas.anulada, false),
        // Dia local de la planta: si usaramos UTC, "hoy" cambiaria a las 21:00.
        sql`${diaLocal(etiquetas.creadoEn)} = ${hoyLocal()}`
      )
    );

  const lotesAbiertos = await db
    .select({
      id: lotes.id,
      codigo: lotes.codigo,
      maquina: lotes.maquinaNombre,
      frasco: lotes.frascoNombre,
      abiertoEn: lotes.abiertoEn,
      cajas: sql<number>`(
        select count(*)::int from ${etiquetas}
        where ${etiquetas.loteId} = ${lotes.id} and ${etiquetas.anulada} = false
      )`,
    })
    .from(lotes)
    .where(eq(lotes.estado, "abierto"));

  return { porEstado, hoy, lotesAbiertos };
}
