import { and, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { etiquetas } from "@/db/schema";
import { finDelDia, inicioDelDia } from "./tiempo";

/**
 * Filtros compartidos entre el historial, las metricas, el export y el reporte.
 *
 * Estan aca, en un modulo propio, para que la misma condicion WHERE alimente a
 * todos. Si divergieran pasaria lo peor: que el Excel exportado o el reporte que
 * recibe el cliente digan otra cosa que la pantalla.
 */
export type Filtros = {
  /** Texto libre: lote, operario, maquina, frasco o numero de caja. */
  q?: string;
  desde?: string; // "2026-08-01", dia local de la planta
  hasta?: string; // inclusive
  operarioId?: number;
  operario?: string;
  maquinaId?: number;
  maquina?: string;
  turno?: string;
  frasco?: string;
  loteId?: number;
  estado?: string; // pendiente | liberada | rechazada
  /** Por defecto las anuladas NO cuentan como produccion. */
  incluirAnuladas?: boolean;
  /** Solo las anuladas (para revisarlas). */
  soloAnuladas?: boolean;
};

const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Rango de fechas.
 *
 * Una fecha suelta se interpreta como dia LOCAL de la planta. El borde superior
 * es exclusivo (< comienzo del dia siguiente) en vez de "<= 23:59:59.999": con
 * timestamptz eso evita perder lo que caiga en el ultimo milisegundo.
 */
export function condicionesRango(f: Filtros): SQL[] {
  const cond: SQL[] = [];
  if (f.desde) {
    cond.push(
      SOLO_FECHA.test(f.desde)
        ? sql`${etiquetas.creadoEn} >= ${inicioDelDia(f.desde)}`
        : sql`${etiquetas.creadoEn} >= ${f.desde}::timestamptz`
    );
  }
  if (f.hasta) {
    cond.push(
      SOLO_FECHA.test(f.hasta)
        ? sql`${etiquetas.creadoEn} < ${finDelDia(f.hasta)}`
        : sql`${etiquetas.creadoEn} <= ${f.hasta}::timestamptz`
    );
  }
  return cond;
}

export function condiciones(f: Filtros): SQL | undefined {
  const cond: SQL[] = condicionesRango(f);

  if (f.soloAnuladas) cond.push(sql`${etiquetas.anulada} = true`);
  else if (!f.incluirAnuladas) cond.push(sql`${etiquetas.anulada} = false`);

  if (f.operarioId) cond.push(sql`${etiquetas.operarioId} = ${f.operarioId}`);
  if (f.operario) cond.push(sql`${etiquetas.operarioNombre} = ${f.operario}`);
  if (f.maquina) cond.push(sql`${etiquetas.maquinaNombre} = ${f.maquina}`);
  if (f.turno) cond.push(sql`${etiquetas.turno} = ${f.turno}`);
  if (f.frasco) cond.push(sql`${etiquetas.frascoNombre} = ${f.frasco}`);
  if (f.loteId) cond.push(sql`${etiquetas.loteId} = ${f.loteId}`);
  if (f.estado) cond.push(sql`${etiquetas.estadoCalidad} = ${f.estado}`);

  if (f.q?.trim()) {
    // ilike: Postgres tiene comparacion sin distinguir mayusculas de fabrica,
    // asi que no hace falta el lower() de todos lados que necesitaba SQLite.
    const s = `%${f.q.trim()}%`;
    const libre = or(
      ilike(etiquetas.loteCodigo, s),
      ilike(etiquetas.operarioNombre, s),
      ilike(etiquetas.maquinaNombre, s),
      ilike(etiquetas.frascoNombre, s),
      sql`${etiquetas.caja}::text ilike ${s}`
    );
    if (libre) cond.push(libre);
  }

  return cond.length ? and(...cond) : undefined;
}

/** Lee los filtros de un querystring, validando lo que tiene que ser numero. */
export function filtrosDeUrl(u: URL): Filtros {
  const s = u.searchParams;
  const num = (k: string) => {
    const v = s.get(k);
    if (!v) return undefined;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  const estado = s.get("estado") ?? undefined;
  return {
    q: s.get("q") ?? undefined,
    desde: s.get("desde") ?? undefined,
    hasta: s.get("hasta") ?? undefined,
    operarioId: num("operarioId"),
    operario: s.get("operario") ?? undefined,
    maquinaId: num("maquinaId"),
    maquina: s.get("maquina") ?? undefined,
    turno: s.get("turno") ?? undefined,
    frasco: s.get("frasco") ?? undefined,
    loteId: num("loteId"),
    estado:
      estado === "pendiente" || estado === "liberada" || estado === "rechazada" ? estado : undefined,
    incluirAnuladas: s.get("incluirAnuladas") === "1",
    soloAnuladas: s.get("soloAnuladas") === "1",
  };
}
