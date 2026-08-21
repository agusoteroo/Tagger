import { cerrarConexion, motorActual } from "@/db";
import { prepararBase } from "@/db/arranque";

/**
 * Aplica las migraciones desde AFUERA, contra la base que diga DATABASE_URL.
 *
 * Esto lo hacia /api/salud en cada instancia fria, y estaba mal: era DDL
 * disparado por una peticion HTTP, varias instancias a la vez, y encima la
 * carpeta drizzle/ con los .sql no viaja al bundle de la funcion (nada en el
 * codigo la importa, asi que el trazado de Next no la incluye).
 *
 * Se corre una vez por deploy que cambie el esquema:
 *   npm run db:migrar
 */
async function main() {
  const destino = (process.env.DATABASE_URL ?? "(default de dev: pglite)").replace(
    // No imprimir la contrasena.
    /:\/\/([^:]+):[^@]+@/,
    "://$1:***@"
  );
  console.log(`motor    : ${motorActual()}`);
  console.log(`destino  : ${destino}`);

  const arranque = Date.now();
  await prepararBase();
  console.log(`listo    : ${Date.now() - arranque} ms`);
}

main()
  .catch((e) => {
    console.error("FALLO:", e);
    process.exitCode = 1;
  })
  .finally(() => cerrarConexion());
