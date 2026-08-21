/**
 * Borra la base y la vuelve a crear desde cero, sembrada.
 *
 *   npm run db:reset
 *
 * SOLO para desarrollo. En producción esto borraría la trazabilidad.
 *
 * Con PGlite borra la carpeta de datos. Con Postgres de verdad tira el esquema
 * `public` y lo recrea: es lo mismo que borrar la base pero sin necesitar
 * permisos de superusuario, que en Supabase no se tienen.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { sql } from "drizzle-orm";

const url = process.env.DATABASE_URL ?? "pglite://./data/pg";
const esWin = process.platform === "win32";

if (process.env.NODE_ENV === "production") {
  console.error("Negado: NODE_ENV=production. Esto borraría la trazabilidad de la planta.");
  process.exit(1);
}

async function main() {
  if (url.startsWith("pglite://") || url.startsWith("file:")) {
    const ruta = url.replace(/^pglite:\/\//, "").replace(/^file:/, "");
    const dir = path.resolve(ruta);
    console.log(`Borrando ${dir}...`);
    fs.rmSync(dir, { recursive: true, force: true });
  } else {
    // Confirmación explícita: contra una base remota esto es destructivo y no
    // hay "deshacer".
    if (!url.includes("localhost") && !url.includes("127.0.0.1") && process.env.CONFIRMO !== "si") {
      console.error(
        `\nEsta base NO es local:\n  ${url.replace(/:[^:@]+@/, ":****@")}\n\n` +
          `Si de verdad querés borrarla, corré:  CONFIRMO=si npm run db:reset\n`
      );
      process.exit(1);
    }
    const { db, cerrarConexion } = await import("../src/db");
    console.log("Tirando el esquema public y recreándolo...");
    await db.execute(sql`drop schema public cascade`);
    await db.execute(sql`create schema public`);
    await cerrarConexion();
  }

  execFileSync(esWin ? "npx.cmd" : "npx", ["tsx", "--env-file-if-exists=.env.local", "src/db/seed.ts"], {
    stdio: "inherit",
    shell: esWin,
  });
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
