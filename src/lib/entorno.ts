/**
 * Lectura de variables de entorno con el default bien puesto.
 *
 * Existe por un bug que aparecio DOS veces y la segunda costo cuatro deploys.
 *
 * Una variable definida pero VACIA no es lo mismo que no definida, y `??` no lo
 * ve: `process.env.X ?? 3` devuelve `""` si X es `""`, porque `""` no es null ni
 * undefined. En Vercel eso pasa facil -- se crea la variable y se guarda sin
 * valor, o con espacios.
 *
 * Los dos casos reales:
 *
 *   TZ_PLANTA=""          -> `""` pasaba la validacion de zona y tumbaba el
 *                            build entero en "Collecting page data".
 *   DB_MAX_CONEXIONES=""  -> `Number("")` es 0, o sea un pool de CERO
 *                            conexiones. Eso no falla: encola las consultas
 *                            para siempre. La peticion se colgaba 300 segundos
 *                            y moria por tiempo sin un solo error, con la red y
 *                            el driver funcionando perfecto.
 *
 * El segundo es el peor de los dos precisamente porque no falla: un valor
 * invalido que rompe fuerte se arregla en minutos, uno que cuelga en silencio
 * se busca por horas. Por eso `entero()` rechaza el 0 y avisa por log en vez de
 * aceptarlo callado.
 */

/** Texto no vacio, o el default. Recorta espacios. */
export function texto(nombre: string, porDefecto: string): string {
  return process.env[nombre]?.trim() || porDefecto;
}

/** Texto no vacio, o null si no hay. Para lo opcional de verdad. */
export function textoOpcional(nombre: string): string | null {
  return process.env[nombre]?.trim() || null;
}

/**
 * Entero dentro de un rango, o el default.
 *
 * Avisa por log cuando descarta un valor: una variable mal puesta que se ignora
 * en silencio es la razon por la que este archivo existe.
 */
export function entero(
  nombre: string,
  porDefecto: number,
  { min = 1, max = Number.MAX_SAFE_INTEGER } = {}
): number {
  const crudo = process.env[nombre]?.trim();
  if (!crudo) return porDefecto;

  const n = Number(crudo);
  if (!Number.isInteger(n) || n < min || n > max) {
    console.warn(
      `[entorno] ${nombre}=${JSON.stringify(crudo)} no sirve ` +
        `(hace falta un entero entre ${min} y ${max}). Uso ${porDefecto}.`
    );
    return porDefecto;
  }
  return n;
}

/** Bandera de encendido: solo "1" prende. */
export function bandera(nombre: string): boolean {
  return process.env[nombre]?.trim() === "1";
}
