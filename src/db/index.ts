import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Conexion a Postgres.
 *
 * Soporta dos destinos, segun como sea DATABASE_URL:
 *
 *   postgres://...   -> Postgres de verdad (Supabase en produccion)
 *   pglite://ruta    -> PGlite: Postgres compilado a WASM, en proceso
 *
 * PGlite existe para desarrollo y tests: es Postgres real (no un emulador), asi
 * que valida el SQL, las funciones de fecha con zona horaria y las
 * restricciones igual que el servidor. Y no necesita Docker ni una base remota,
 * lo que hace que los tests corran en cualquier maquina sin preparar nada.
 *
 * IMPORTANTE sobre la cadena de Supabase:
 *
 * En serverless hay que usar el **pooler en modo transaccion** (puerto 6543),
 * NO la conexion directa (5432). Cada invocacion de funcion abre su propia
 * conexion y el limite de directas se agota rapido.
 *
 * Y con el pooler en modo transaccion hay que desactivar los prepared
 * statements (`prepare: false`): el pooler reparte la misma conexion entre
 * transacciones distintas, asi que un statement preparado en una puede no
 * existir en la siguiente.
 */

const URL_DEFECTO_DEV = "pglite://./data/pg";

function url() {
  const u = process.env.DATABASE_URL;
  if (u) return u;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Falta DATABASE_URL. Es la cadena del pooler de Supabase " +
        "(Project Settings -> Database -> Connection string -> Transaction pooler, puerto 6543)."
    );
  }
  return URL_DEFECTO_DEV;
}

type Db = ReturnType<typeof drizzlePg<typeof schema>>;

function crear(): { db: Db; cerrar: () => Promise<void>; motor: "postgres" | "pglite" } {
  const u = url();

  if (u.startsWith("pglite://") || u.startsWith("file:")) {
    // Import sincronico via require: PGlite solo se carga si de verdad se usa,
    // asi no entra en el bundle de produccion.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PGlite } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drizzle: drizzlePglite } = require("drizzle-orm/pglite") as typeof import("drizzle-orm/pglite");

    const ruta = u.replace(/^pglite:\/\//, "").replace(/^file:/, "");
    const cliente = new PGlite(ruta || undefined);
    // Los dos drivers exponen la misma API para todo lo que usa este proyecto
    // (select/insert/update/delete/transaction). El cast evita duplicar tipos.
    return {
      db: drizzlePglite(cliente, { schema }) as unknown as Db,
      cerrar: () => cliente.close(),
      motor: "pglite",
    };
  }

  const esPooler = u.includes(":6543");
  if (process.env.NODE_ENV === "production" && !esPooler) {
    // Aviso, no error: en un VPS con un solo proceso la directa esta bien.
    console.warn(
      "[db] DATABASE_URL no apunta al pooler (:6543). En serverless eso agota las conexiones."
    );
  }

  const cliente = postgres(u, {
    // Sin prepared statements: obligatorio con el pooler en modo transaccion.
    prepare: false,
    // Pocas conexiones por instancia: son muchas instancias, no una grande.
    max: Number(process.env.DB_MAX_CONEXIONES ?? 3),
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {}, // Postgres avisa cosas como "table already exists"; no ensuciar el log.
  });

  return { db: drizzlePg(cliente, { schema }), cerrar: () => cliente.end(), motor: "postgres" };
}

// Next recarga los modulos en caliente en dev. Sin este singleton se abririan
// decenas de pools contra la misma base.
const g = globalThis as unknown as { __conexion?: ReturnType<typeof crear> };
const conexion = g.__conexion ?? crear();
if (process.env.NODE_ENV !== "production") g.__conexion = conexion;

export const db = conexion.db;
export const cerrarConexion = conexion.cerrar;
export const motor = conexion.motor;
export { schema };
