import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { entero } from "@/lib/entorno";
import * as schema from "./schema";

/**
 * Conexion a Postgres.
 *
 * LA CONEXION ES PEREZOSA, y eso no es un detalle de estilo.
 *
 * `next build` importa todos los modulos de ruta para recolectar su
 * configuracion. Si la conexion se creara al importar, el build fallaria en
 * "Collecting page data" cada vez que DATABASE_URL no este disponible en tiempo
 * de compilacion -- que es justo lo que pasa en Vercel antes de configurar las
 * variables. Peor: un build que necesita la base de produccion para compilar
 * ata el deploy a que la base este arriba.
 *
 * Con el proxy de abajo, importar este modulo no hace nada. La conexion se abre
 * en la primera consulta de verdad.
 *
 * Soporta dos destinos, segun como sea DATABASE_URL:
 *
 *   postgres://...   -> Postgres de verdad (Supabase en produccion)
 *   pglite://ruta    -> PGlite: Postgres compilado a WASM, en proceso
 *
 * PGlite existe para desarrollo y tests: es Postgres real (no un emulador), asi
 * que valida el SQL, las funciones de fecha con zona horaria y las
 * restricciones igual que el servidor, sin necesitar Docker ni una base remota.
 * Soporta UN solo proceso a la vez.
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

type Db = ReturnType<typeof drizzlePg<typeof schema>>;
type Conexion = {
  db: Db;
  cerrar: () => Promise<void>;
  motor: "postgres" | "pglite";
  /** Tamano efectivo del pool. Se informa en /api/salud a proposito: un pool de
   *  cero conexiones no da error, encola para siempre, y desde afuera se ve
   *  igual que una base caida. */
  pool: number;
};

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

function crear(): Conexion {
  const u = url();

  if (u.startsWith("pglite://") || u.startsWith("file:")) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PGlite } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drizzle: drizzlePglite } =
      require("drizzle-orm/pglite") as typeof import("drizzle-orm/pglite");

    const ruta = u.replace(/^pglite:\/\//, "").replace(/^file:/, "");
    const cliente = new PGlite(ruta || undefined);
    // Los dos drivers exponen la misma API para todo lo que usa este proyecto
    // (select/insert/update/delete/transaction/execute). El cast evita duplicar
    // tipos en toda la capa de datos.
    return {
      db: drizzlePglite(cliente, { schema }) as unknown as Db,
      cerrar: () => cliente.close(),
      motor: "pglite",
      pool: 1,
    };
  }

  if (process.env.NODE_ENV === "production" && !u.includes(":6543")) {
    // Aviso, no error: contra un Postgres con un solo proceso la directa está
    // bien. En serverless agota las conexiones, y el sintoma es traicionero:
    // anda con poco trafico y falla cuando hay uso real.
    console.warn(
      "[db] DATABASE_URL no apunta al pooler (:6543). En serverless eso agota las conexiones."
    );
  }

  const pool = entero("DB_MAX_CONEXIONES", 3, { min: 1, max: 20 });

  const cliente = postgres(u, {
    prepare: false,
    // entero() y no Number(): con DB_MAX_CONEXIONES="" esto daba max: 0, o sea
    // un pool de cero conexiones. No falla -- encola las consultas para
    // siempre. Fue el cuelgue de 300 s en Vercel, con la red y el driver
    // andando perfecto.
    max: pool,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {}, // Postgres avisa cosas como "table already exists"; no ensuciar el log.
  });

  return { db: drizzlePg(cliente, { schema }), cerrar: () => cliente.end(), motor: "postgres", pool };
}

// Next recarga los modulos en caliente en dev. Sin el singleton se abririan
// decenas de pools contra la misma base.
const g = globalThis as unknown as { __conexion?: Conexion };

function conexion(): Conexion {
  if (!g.__conexion) g.__conexion = crear();
  return g.__conexion;
}

/**
 * `db` es un proxy: importarlo no abre nada. La conexion se crea recien cuando
 * alguien llama a un metodo (select, insert, transaction, execute...).
 */
export const db = new Proxy({} as Db, {
  get(_destino, prop, receptor) {
    const real = conexion().db as unknown as Record<string | symbol, unknown>;
    const valor = real[prop];
    return typeof valor === "function" ? valor.bind(real) : valor;
  },
  has(_destino, prop) {
    return prop in (conexion().db as unknown as object);
  },
}) as Db;

/** Tamano efectivo del pool. Abre la conexion si hace falta. */
export function poolActual(): number {
  return conexion().pool;
}

/** No abre la conexion si nunca se uso: cerrar algo que no existe es un no-op. */
export async function cerrarConexion() {
  if (!g.__conexion) return;
  const c = g.__conexion;
  g.__conexion = undefined;
  await c.cerrar();
}

/** Qué motor quedó activo. Abre la conexión si hace falta. */
export function motorActual() {
  return conexion().motor;
}

export { schema };
