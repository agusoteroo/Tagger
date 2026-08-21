import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { etiquetas } from "@/db/schema";
import { ErrorNegocio } from "./errores";
import { condiciones, type Filtros } from "./filtros";
import { diaLocal } from "./tiempo";

/**
 * Agregaciones para medir eficiencia. Esto es lo que no se puede sacar de una
 * lista de filas: cuanto produjo cada operario, cada turno y cada maquina en un
 * rango de fechas.
 */

export const DIMENSIONES = ["operario", "turno", "maquina", "frasco", "dia", "lote"] as const;
export type Dimension = (typeof DIMENSIONES)[number];

const COLUMNA: Record<Dimension, SQL<string>> = {
  operario: sql<string>`${etiquetas.operarioNombre}`,
  turno: sql<string>`${etiquetas.turno}`,
  maquina: sql<string>`${etiquetas.maquinaNombre}`,
  frasco: sql<string>`${etiquetas.frascoNombre}`,
  lote: sql<string>`${etiquetas.loteCodigo}`,
  // Dia LOCAL de la planta, no UTC: si no, el turno noche se parte en dos.
  dia: diaLocal(etiquetas.creadoEn),
};

export function esDimension(v: string | null | undefined): v is Dimension {
  return !!v && (DIMENSIONES as readonly string[]).includes(v);
}

export type FilaMetrica = {
  clave: string;
  cajas: number;
  unidades: number;
  liberadas: number;
  pendientes: number;
  rechazadas: number;
  anuladas: number;
  primera: string | null;
  ultima: string | null;
  /** Días distintos en que este grupo produjo algo. */
  dias: number;
  /**
   * Minutos trabajados: la SUMA de los lapsos de cada día por separado.
   * No es el lapso entre la primera y la última etiqueta del rango — eso
   * incluiría noches y fines de semana y daría un ritmo falso.
   */
  minutosActivos: number;
  /** cajas / horas trabajadas. null si no hay lapso suficiente para juzgarlo. */
  cajasPorHora: number | null;
  /** Promedio de cajas por día trabajado. */
  cajasPorDia: number | null;
  /** % de cajas rechazadas sobre las ya dictaminadas por Calidad. */
  tasaRechazo: number | null;
};

// Las anuladas se cuentan aparte pero no suman a produccion: por eso el filtro
// va dentro de cada SUM y no en el WHERE.
const NO_ANULADA = sql`${etiquetas.anulada} = false`;

// El ::int no es opcional: Postgres devuelve count() y sum() como bigint, y el
// driver los entrega como string. Sin el cast, "12" + "5" daria "125".
const AGREGADOS = {
  cajas: sql<number>`coalesce(sum(case when ${NO_ANULADA} then 1 else 0 end), 0)::int`,
  unidades: sql<number>`coalesce(sum(case when ${NO_ANULADA} then ${etiquetas.cantidad} else 0 end), 0)::int`,
  liberadas: sql<number>`coalesce(sum(case when ${NO_ANULADA} and ${etiquetas.estadoCalidad} = 'liberada' then 1 else 0 end), 0)::int`,
  pendientes: sql<number>`coalesce(sum(case when ${NO_ANULADA} and ${etiquetas.estadoCalidad} = 'pendiente' then 1 else 0 end), 0)::int`,
  rechazadas: sql<number>`coalesce(sum(case when ${NO_ANULADA} and ${etiquetas.estadoCalidad} = 'rechazada' then 1 else 0 end), 0)::int`,
  anuladas: sql<number>`coalesce(sum(case when ${etiquetas.anulada} = true then 1 else 0 end), 0)::int`,
  primera: sql<string | null>`min(case when ${NO_ANULADA} then ${etiquetas.creadoEn} end)`,
  ultima: sql<string | null>`max(case when ${NO_ANULADA} then ${etiquetas.creadoEn} end)`,
};

/**
 * Minutos realmente trabajados por grupo.
 *
 * Se calcula por (grupo, dia) y despues se suman los dias. Es la diferencia
 * entre "trabajó 6 horas repartidas en 12 días" y "el lapso entre su primera y
 * su última caja fue de 12 días" -- lo segundo daría un ritmo absurdo.
 *
 * Sigue siendo un proxy: mide de la primera a la última caja de cada día, así
 * que no ve el tiempo antes de la primera ni después de la última, y sí cuenta
 * las pausas del medio.
 *
 * En Postgres esto se puede hacer en UNA consulta con una subconsulta agrupada,
 * en vez de traer las filas por día y sumarlas en JavaScript. Contra una base
 * remota, cada viaje de ida y vuelta se paga en latencia.
 */
async function tiemposPorGrupo(col: SQL<string>, f: Filtros) {
  const porDia = db
    .select({
      clave: sql<string>`${col}`.as("clave"),
      // extract(epoch) da segundos; /60 -> minutos. Reemplaza al julianday()
      // de SQLite, que devolvia dias fraccionarios.
      minutos: sql<number>`extract(epoch from (max(${etiquetas.creadoEn}) - min(${etiquetas.creadoEn}))) / 60.0`.as(
        "minutos"
      ),
    })
    .from(etiquetas)
    .where(condiciones({ ...f, incluirAnuladas: false, soloAnuladas: false }))
    .groupBy(sql`${col}`, diaLocal(etiquetas.creadoEn))
    .as("por_dia");

  const filas = await db
    .select({
      clave: porDia.clave,
      minutos: sql<number>`coalesce(sum(${porDia.minutos}), 0)::float8`,
      dias: sql<number>`count(*)::int`,
    })
    .from(porDia)
    .groupBy(porDia.clave);

  return new Map(filas.map((r) => [r.clave, { minutos: Number(r.minutos), dias: r.dias }]));
}

/** Agrupa por una dimension y devuelve produccion + calidad de cada grupo. */
export async function porDimension(dim: Dimension, f: Filtros = {}): Promise<FilaMetrica[]> {
  if (!esDimension(dim)) {
    throw new ErrorNegocio(`Dimensión inválida. Válidas: ${DIMENSIONES.join(", ")}.`);
  }
  const col = COLUMNA[dim];

  // SECUENCIAL, no en paralelo.
  //
  // Esto arrancó con un Promise.all "para bajar latencia" y fue un error: con
  // el pool chico que conviene en serverless, abanicar consultas las hace
  // pelearse por conexiones y el endpoint pasaba de 122 ms a colgarse minutos.
  //
  // Medido: las tres consultas del tablero, secuenciales, 122 ms en total. En
  // paralelo, no terminaban. Son consultas chicas: lo que pesa es la conexión,
  // no el cálculo, así que no hay nada que ganar solapándolas.
  const filas = await db
    .select({ clave: sql<string>`${col}`, ...AGREGADOS })
    .from(etiquetas)
    // incluirAnuladas: el WHERE no las excluye porque las necesitamos contar.
    .where(condiciones({ ...f, incluirAnuladas: true, soloAnuladas: false }))
    .groupBy(col)
    .having(sql`${col} is not null`);

  const tiempos = await tiemposPorGrupo(col, f);

  return filas
    .map((r) => {
      const t = tiempos.get(r.clave) ?? { minutos: 0, dias: 0 };
      const minutos = Math.round(t.minutos);
      const dictaminadas = r.liberadas + r.rechazadas;
      return {
        ...r,
        dias: t.dias,
        minutosActivos: minutos,
        // Con menos de 2 cajas o menos de 10 minutos el ritmo no dice nada.
        cajasPorHora:
          minutos >= 10 && r.cajas >= 2 ? Math.round((r.cajas / (minutos / 60)) * 10) / 10 : null,
        cajasPorDia: t.dias > 0 ? Math.round((r.cajas / t.dias) * 10) / 10 : null,
        tasaRechazo: dictaminadas > 0 ? Math.round((r.rechazadas / dictaminadas) * 1000) / 10 : null,
      };
    })
    .sort((a, b) => b.unidades - a.unidades || a.clave.localeCompare(b.clave, "es"));
}

/** Totales del rango, para las tarjetas de arriba del tablero. */
export async function totales(f: Filtros = {}) {
  const [r] = await db
    .select({
      ...AGREGADOS,
      operarios: sql<number>`count(distinct case when ${NO_ANULADA} then ${etiquetas.operarioNombre} end)::int`,
      lotes: sql<number>`count(distinct case when ${NO_ANULADA} then ${etiquetas.loteId} end)::int`,
      dias: sql<number>`count(distinct case when ${NO_ANULADA} then ${diaLocal(etiquetas.creadoEn)} end)::int`,
    })
    .from(etiquetas)
    .where(condiciones({ ...f, incluirAnuladas: true, soloAnuladas: false }));

  return (
    r ?? {
      cajas: 0,
      unidades: 0,
      liberadas: 0,
      pendientes: 0,
      rechazadas: 0,
      anuladas: 0,
      operarios: 0,
      lotes: 0,
      dias: 0,
      primera: null,
      ultima: null,
    }
  );
}

/** Serie por dia local, para el grafico de tendencia. */
export async function serieDiaria(f: Filtros = {}) {
  const filas = await porDimension("dia", f);
  return filas.sort((a, b) => a.clave.localeCompare(b.clave));
}
