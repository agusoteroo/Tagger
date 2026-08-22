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
  return !!recorrer(e).violacion;
}

/**
 * Recorre la cadena de `cause` y devuelve si hubo violacion de unicidad y, si se
 * puede, QUE restriccion la produjo.
 *
 * El nombre de la restriccion importa: no todas las violaciones de unicidad se
 * arreglan reintentando. La colision de numero de lote si (dos altas simultaneas
 * del mismo producto pelean por el mismo numero, y al segundo intento uno gana).
 * Pero "un solo lote abierto por maquina" es un error de logica: reintentarlo
 * ocho veces solo demora dos segundos el fallo y devuelve un mensaje que apunta
 * al lugar equivocado ("no se pudo asignar un numero unico" cuando el problema
 * era otro).
 */
function recorrer(e: unknown): { violacion: boolean; restriccion: string | null } {
  let actual: unknown = e;
  const vistos = new Set<unknown>();
  let violacion = false;
  let restriccion: string | null = null;

  while (actual && typeof actual === "object" && !vistos.has(actual)) {
    vistos.add(actual);
    const err = actual as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
      constraint_name?: unknown;
    };

    if (err.code === UNIQUE_VIOLATION) violacion = true;
    if (typeof err.message === "string" && /duplicate key value|unique constraint/i.test(err.message)) {
      violacion = true;
      // El nombre aparece en el mensaje incluso cuando el campo no viaja.
      const m = err.message.match(/(?:unique constraint|restriccion unica)\s+"([^"]+)"/i);
      if (m && !restriccion) restriccion = m[1]!;
    }
    if (typeof err.constraint_name === "string" && !restriccion) {
      restriccion = err.constraint_name;
    }
    actual = err.cause;
  }
  return { violacion, restriccion };
}

export async function conReintentoUnico<T>(
  fn: () => Promise<T>,
  opciones: {
    intentos?: number;
    que?: string;
    /**
     * Si se pasa, SOLO se reintenta cuando la restriccion violada es esta. Otra
     * violacion de unicidad se propaga tal cual, porque reintentarla no la va a
     * arreglar y el mensaje de "no se pudo asignar un numero unico" mandaria a
     * buscar el problema donde no esta.
     */
    soloRestriccion?: string;
  } = {}
): Promise<T> {
  const intentos = opciones.intentos ?? 8;
  let ultimo: unknown;

  for (let i = 0; i < intentos; i++) {
    try {
      return await fn();
    } catch (e) {
      const { violacion, restriccion } = recorrer(e);
      if (!violacion) throw e;
      if (opciones.soloRestriccion && restriccion && restriccion !== opciones.soloRestriccion) {
        throw e;
      }
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
