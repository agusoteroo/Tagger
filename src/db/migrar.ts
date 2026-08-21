import path from "node:path";
import { db, motorActual } from "./index";

/**
 * Aplica las migraciones de ./drizzle.
 *
 * En produccion no se usa `drizzle-kit push`: adivina los cambios y puede
 * borrar datos. Se aplican los SQL versionados que estan en el repo, que son
 * los mismos que se probaron en desarrollo.
 *
 * Idempotente: si ya estan aplicadas, no hace nada.
 */
export async function migrar() {
  const carpeta = path.join(process.cwd(), "drizzle");

  if (motorActual() === "pglite") {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(db as any, { migrationsFolder: carpeta });
    return;
  }

  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await migrate(db as any, { migrationsFolder: carpeta });
}
