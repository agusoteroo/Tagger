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
  const url = process.env.DATABASE_URL ?? "pglite://./data/pg";
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
