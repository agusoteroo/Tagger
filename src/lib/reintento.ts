/**
 * Reintento sobre violación de UNIQUE.
 *
 * En SQLite la numeración de cajas se protegía con `BEGIN IMMEDIATE`: tomaba el
 * lock de escritura antes de leer el MAX, así nadie se colaba. Postgres no
 * tiene eso, y bajo READ COMMITTED dos transacciones pueden leer el mismo MAX
 * y querer insertar el mismo número.
 *
 * La defensa sigue siendo la restricción UNIQUE, que es la que de verdad
 * garantiza que no haya duplicados. Lo que agrega esto es que, cuando la
 * restricción rechaza, se reintente en vez de perder la etiqueta.
 *
 * Es la razón por la que el UNIQUE no es "por si acaso": es el mecanismo.
 */

/** Código de Postgres para "unique_violation". */
const UNIQUE_VIOLATION = "23505";

/**
 * Busca el código de error de Postgres recorriendo la cadena de `cause`.
 *
 * Esto NO es paranoia defensiva: drizzle envuelve el error del driver en un
 * `DrizzleQueryError` cuyo mensaje es "Failed query: insert into ...", y el
 * código 23505 queda enterrado en `cause`. Mirando solo el nivel de arriba, la
 * violación de unicidad no se detectaba, no se reintentaba, y la etiqueta se
 * perdía en silencio.
 *
 * Lo encontró el test de concurrencia: 5 de 6 workers escribieron cero cajas y
 * reportaron 20 rechazos cada uno.
 */
function esViolacionUnica(e: unknown): boolean {
  let actual: unknown = e;
  const vistos = new Set<unknown>();

  while (actual && typeof actual === "object" && !vistos.has(actual)) {
    vistos.add(actual);
    const err = actual as { code?: unknown; message?: unknown; cause?: unknown };

    if (err.code === UNIQUE_VIOLATION) return true;
    if (typeof err.message === "string" && /duplicate key value|unique constraint/i.test(err.message)) {
      return true;
    }
    actual = err.cause;
  }
  return false;
}

export async function conReintentoUnico<T>(
  fn: () => Promise<T>,
  opciones: { intentos?: number; que?: string } = {}
): Promise<T> {
  const intentos = opciones.intentos ?? 8;
  let ultimo: unknown;

  for (let i = 0; i < intentos; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!esViolacionUnica(e)) throw e;
      ultimo = e;
      if (i < intentos - 1) {
        // Espera creciente con algo de azar. El azar importa cuando hay varios
        // escritores: sin él, los que chocan reintentan todos al mismo tiempo y
        // vuelven a chocar.
        const base = Math.min(10 * 2 ** i, 400);
        await new Promise((r) => setTimeout(r, base + Math.random() * base));
      }
    }
  }

  throw new Error(
    `No se pudo asignar un número único${opciones.que ? ` para ${opciones.que}` : ""} ` +
      `después de ${intentos} intentos. Reintentá en unos segundos. ` +
      `(${String((ultimo as { message?: string })?.message ?? ultimo).slice(0, 160)})`
  );
}
