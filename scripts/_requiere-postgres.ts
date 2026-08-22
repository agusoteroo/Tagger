/**
 * Guard para los tests que necesitan Postgres de verdad.
 *
 * PGlite corre en proceso y soporta UN solo proceso a la vez. Estos tests abren
 * su propia conexión además del dev server (o lanzan procesos paralelos), así
 * que contra PGlite fallarían con un error de lock que no dice nada útil.
 *
 * Mejor cortar temprano y explicar qué falta.
 */
export function requierePostgres(nombre: string) {
  const url = process.env.DATABASE_URL?.trim() || "pglite://./data/pg";
  if (!url.startsWith("pglite://") && !url.startsWith("file:")) return;

  console.error(
    `\n${nombre} necesita Postgres de verdad, no PGlite.\n\n` +
      `  PGlite corre en proceso y soporta un solo proceso a la vez. Este test\n` +
      `  abre su propia conexión (y en el caso de concurrencia, varios procesos),\n` +
      `  así que contra PGlite se traba.\n\n` +
      `  Poné en .env.local la cadena del pooler de Supabase:\n\n` +
      `    DATABASE_URL=postgresql://postgres.PROYECTO:PASSWORD@...pooler.supabase.com:6543/postgres\n`
  );
  process.exit(1);
}

/**
 * Traba para no ensuciar una base que esta en uso.
 *
 * Los tests escriben: crean lotes, etiquetas, cambian PINs. Mientras la unica
 * base era local eso no importaba. Ahora DATABASE_URL apunta a la Supabase de
 * produccion, y correr `npm test` le mete cientos de etiquetas de prueba a la
 * base que el cliente va a mirar. Ya paso: 168 etiquetas y un lote con limite
 * 1.000.000 quedaron ahi.
 *
 * PGlite y localhost pasan libres. Cualquier otra base pide confirmacion
 * explicita, igual que reset.ts.
 *
 * Lo prolijo de verdad es una segunda base para pruebas -- el plan gratuito de
 * Supabase permite dos proyectos -- y ahi esta traba no molesta nunca.
 */
export function requiereBaseDePrueba(nombre: string) {
  const url = process.env.DATABASE_URL?.trim() || "pglite://./data/pg";

  const esLocal =
    url.startsWith("pglite://") ||
    url.startsWith("file:") ||
    url.includes("localhost") ||
    url.includes("127.0.0.1");

  if (esLocal || process.env.BASE_DE_PRUEBA === "si") return;

  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "(host ilegible)";
    }
  })();

  console.error(
    `
${nombre} escribe en la base, y DATABASE_URL apunta a una base remota:

` +
      `    ${host}

` +
      `  Si es la base de produccion, esto le deja lotes y etiquetas de prueba
` +
      `  adentro. Si de verdad querés escribir ahí, confirmalo:

` +
      `    BASE_DE_PRUEBA=si npm run ${nombre}

` +
      `  Lo mejor es tener un segundo proyecto de Supabase solo para pruebas: el
` +
      `  plan gratuito permite dos, y así esta traba no molesta nunca.
`
  );
  process.exit(1);
}

/**
 * Traba para los tests que prueban por HTTP.
 *
 * test:flujo y test:export no llaman a las funciones: le pegan a la API como lo
 * haria el navegador, que es el unico modo de verificar que el CSV y la pantalla
 * dicen lo mismo. Necesitan el server arriba.
 *
 * Sin esto el fallo es un `TypeError: fetch failed` con un ECONNREFUSED
 * enterrado en `cause`, que no dice que hay que levantar nada.
 */
export async function requiereServidor(nombre: string, base: string) {
  try {
    const r = await fetch(`${base}/api/salud`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) return;
    console.error(`\n${nombre}: ${base} responde ${r.status} en /api/salud.\n`);
  } catch {
    console.error(
      `\n${nombre} prueba por HTTP y no hay nada escuchando en ${base}.\n\n` +
        `  En otra terminal:\n\n` +
        `    npm run build\n` +
        `    npx next start -p ${new URL(base).port || "3100"}\n`
    );
  }
  process.exit(1);
}
