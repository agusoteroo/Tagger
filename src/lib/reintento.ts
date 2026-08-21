/**
 * Reintento sobre violacion de UNIQUE.
 *
 * En SQLite la numeracion de cajas se protegia con `BEGIN IMMEDIATE`: tomaba el
 * lock de escritura antes de leer el MAX, asi nadie se colaba. Postgres no
 * tiene eso, y bajo READ COMMITTED dos transacciones pueden leer el mismo MAX
 * y querer insertar el mismo numero.
 *
 * La defensa sigue siendo la misma restriccion UNIQUE, que es la que de verdad
 * garantiza que no haya duplicados. Lo unico que agrega esto es que, cuando la
 * restriccion rechaza, se reintente en vez de mostrarle un error al operario.
 *
 * Es la razon por la que el UNIQUE no es "por si acaso": es el mecanismo.
 */

/** Codigo de Postgres para "unique_violation". */
const UNIQUE_VIOLATION = "23505";

function esViolacionUnica(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { code?: string; constraint_name?: string; message?: string };
  if (err.code === UNIQUE_VIOLATION) return true;
  // Por si el driver la envuelve y solo queda el mensaje.
  return /duplicate key value|unique constraint/i.test(err.message ?? "");
}

export async function conReintentoUnico<T>(
  fn: () => Promise<T>,
  opciones: { intentos?: number; que?: string } = {}
): Promise<T> {
  const intentos = opciones.intentos ?? 5;
  let ultimo: unknown;

  for (let i = 0; i < intentos; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!esViolacionUnica(e)) throw e;
      ultimo = e;
      // Espera creciente y corta: 5ms, 10ms, 20ms... Sin randomizar porque con
      // un solo puesto escribiendo esto practicamente no se ejecuta nunca.
      if (i < intentos - 1) await new Promise((r) => setTimeout(r, 5 * 2 ** i));
    }
  }

  throw new Error(
    `No se pudo asignar un número único${opciones.que ? ` para ${opciones.que}` : ""} ` +
      `después de ${intentos} intentos. Reintentá en unos segundos. (${String(ultimo).slice(0, 120)})`
  );
}
