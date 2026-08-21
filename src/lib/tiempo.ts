import { sql, type SQL } from "drizzle-orm";

/**
 * Zona horaria de la planta.
 *
 * En Postgres esto quedó mejor que en SQLite. Antes era un offset fijo de -3
 * horas; ahora se usa el nombre de la zona, así que si Argentina alguna vez
 * vuelve al horario de verano, las fechas siguen agrupándose bien sin tocar
 * nada. Con un offset fijo habría que acordarse de cambiarlo.
 *
 * Las marcas de tiempo se guardan en `timestamptz` (UTC internamente, que es
 * lo correcto: no cambian nunca y ordenan siempre). Lo que usa la zona es el
 * agrupado "por día": una caja etiquetada a las 21:30 de Buenos Aires es 00:30
 * UTC del día siguiente, y si agrupáramos por UTC el turno noche se partiría
 * en dos días distintos.
 */

const ZONA_POR_DEFECTO = "America/Argentina/Buenos_Aires";

/**
 * `||` y no `??` a propósito.
 *
 * `??` solo cae al valor por defecto con `null` o `undefined`. Una variable de
 * entorno definida pero VACÍA da `""`, que con `??` pasaba de largo — y el
 * build de Vercel fallaba con `TZ_PLANTA inválida: ""`. Una variable vacía es
 * lo mismo que no tenerla.
 */
export const ZONA = process.env.TZ_PLANTA?.trim() || ZONA_POR_DEFECTO;

/**
 * La zona va INTERPOLADA en el SQL, no como parámetro bindeado.
 *
 * Suena mal, pero es necesario: Postgres decide si una columna está agrupada
 * comparando las expresiones de forma sintáctica, y `$1` y `$2` son parámetros
 * distintos aunque tengan el mismo valor. Con la zona como parámetro, el
 * `GROUP BY ((creado_en AT TIME ZONE $2)::date)` no coincide con el
 * `SELECT ((creado_en AT TIME ZONE $1)::date)` y Postgres rechaza la consulta
 * con "must appear in the GROUP BY clause".
 *
 * Es seguro porque el valor no viene de un usuario: sale de una variable de
 * entorno que definimos nosotros. Igual se valida, porque una env var mal
 * puesta no debería poder inyectar SQL.
 */
function validar(zona: string): string {
  if (!/^[A-Za-z0-9_+\-/]{1,64}$/.test(zona)) {
    throw new Error(
      `TZ_PLANTA inválida: ${JSON.stringify(zona)}. ` +
        `Tiene que ser un nombre de zona como "${ZONA_POR_DEFECTO}".`
    );
  }
  return zona;
}

/**
 * PEREZOSO, no una constante de módulo.
 *
 * Antes esto era `const EN_ZONA = sql.raw(...)`, que ejecuta la validación al
 * IMPORTAR el módulo. `next build` importa todos los módulos de ruta para
 * recolectar su configuración, así que una zona mal puesta rompía el build
 * entero en "Collecting page data" en vez de fallar al usarse.
 *
 * Es el mismo error que la conexión a la base: nada de trabajo que pueda fallar
 * en tiempo de importación.
 */
let enZonaCache: SQL | null = null;
function enZona(): SQL {
  enZonaCache ??= sql.raw(`AT TIME ZONE '${validar(ZONA)}'`);
  return enZonaCache;
}

/**
 * Fecha local de la planta (YYYY-MM-DD) para una columna timestamptz.
 *
 * El `::text` final no es decorativo: sin él, el driver devuelve un objeto Date
 * de JavaScript en vez de la cadena "2026-08-20", y la clave del agrupado por
 * día deja de ser comparable como texto.
 */
export function diaLocal(col: SQL | unknown): SQL<string> {
  return sql<string>`((${col} ${enZona()})::date)::text`;
}

/** Hoy, en fecha local de la planta. */
export function hoyLocal(): SQL<string> {
  return sql<string>`((now() ${enZona()})::date)::text`;
}

/**
 * Convierte una fecha local de la planta ("2026-08-20") al instante UTC de su
 * comienzo y de su final, para comparar contra timestamptz.
 *
 * Se hace en SQL y no en JS a propósito: Postgres conoce la zona y su historia
 * de cambios, y `new Date()` en el servidor no tiene por qué estar en la zona
 * de la planta (en Vercel corre en UTC).
 *
 * Acá la fecha SÍ va como parámetro: viene del querystring, o sea del usuario.
 */
export function inicioDelDia(fecha: string): SQL {
  return sql`((${fecha}::date)::timestamp ${enZona()})`;
}

export function finDelDia(fecha: string): SQL {
  return sql`((${fecha}::date + 1)::timestamp ${enZona()})`;
}
