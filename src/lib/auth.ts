import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { configuracion, intentosPin } from "@/db/schema";

/**
 * Roles y permisos.
 *
 * No es una escalera: el JEFE DE PLANTA abre lotes pero no dictamina calidad, y
 * Calidad dictamina pero no abre lotes. Ninguno es "más" que el otro, así que
 * cada rol tiene un conjunto de permisos explícito.
 */
export type Rol = "operario" | "jefe" | "calidad" | "admin";

export type Permiso =
  | "etiquetar" // generar etiquetas
  | "ver" // historial y eficiencia
  | "lotes" // preparar, cerrar y cancelar lotes
  | "calidad" // liberar y rechazar
  | "anular" // anular etiquetas
  | "config"; // maquinas, operarios, frascos, turnos, PINs

const PERMISOS: Record<Rol, Permiso[]> = {
  // La pantalla de etiquetar es libre: el operario no se loguea para producir.
  operario: ["etiquetar"],
  jefe: ["etiquetar", "ver", "lotes"],
  calidad: ["etiquetar", "ver", "calidad"],
  admin: ["etiquetar", "ver", "lotes", "calidad", "anular", "config"],
};

export const ROLES: Rol[] = ["operario", "jefe", "calidad", "admin"];

export function puede(rol: Rol | null, permiso: Permiso): boolean {
  return PERMISOS[rol ?? "operario"].includes(permiso);
}

export function permisosDe(rol: Rol): Permiso[] {
  return PERMISOS[rol];
}

export const ETIQUETA_ROL: Record<Rol, string> = {
  operario: "Operario",
  jefe: "Jefe de planta",
  calidad: "Calidad",
  admin: "Administración",
};

const QUIEN_PUEDE: Record<Permiso, string> = {
  etiquetar: "cualquiera",
  ver: "Jefe de planta, Calidad o Administración",
  lotes: "Jefe de planta o Administración",
  calidad: "Calidad o Administración",
  anular: "Administración",
  config: "Administración",
};

export function mensajeFalta(permiso: Permiso) {
  return `Esta acción requiere el PIN de ${QUIEN_PUEDE[permiso]}.`;
}

// ---------------------------------------------------------------------------
// Hash de PIN con scrypt. El PIN en claro no se guarda ni viaja al navegador.
// ---------------------------------------------------------------------------
export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(pin.normalize("NFKC"), salt, 64);
  return `scrypt$${salt.toString("hex")}$${dk.toString("hex")}`;
}

function verificarHash(pin: string, guardado: string): boolean {
  const [algo, saltHex, dkHex] = guardado.split("$");
  if (algo !== "scrypt" || !saltHex || !dkHex) return false;
  const dk = crypto.scryptSync(pin.normalize("NFKC"), Buffer.from(saltHex, "hex"), 64);
  const esperado = Buffer.from(dkHex, "hex");
  if (dk.length !== esperado.length) return false;
  return crypto.timingSafeEqual(dk, esperado);
}

type RolConPin = Exclude<Rol, "operario">;
const CLAVE_PIN: Record<RolConPin, string> = {
  jefe: "pin_jefe",
  calidad: "pin_calidad",
  admin: "pin_admin",
};
/** De más permisos a menos: si dos roles compartieran PIN, gana el mayor. */
const PRIORIDAD: RolConPin[] = ["admin", "calidad", "jefe"];

async function mapaConfig() {
  const filas = await db.select().from(configuracion);
  return new Map(filas.map((f) => [f.clave, f.valor]));
}

/**
 * Devuelve el rol que habilita ese PIN, o null.
 *
 * Se prueban TODOS los PINs siempre, sin corto circuito, para que el tiempo de
 * respuesta no delate cuál acertó.
 */
export async function rolDePin(pin: string): Promise<Rol | null> {
  const mapa = await mapaConfig();

  const aciertos = new Set<RolConPin>();
  for (const rol of PRIORIDAD) {
    const guardado = mapa.get(CLAVE_PIN[rol]);
    if (guardado && verificarHash(pin, guardado)) aciertos.add(rol);
  }
  for (const rol of PRIORIDAD) {
    if (aciertos.has(rol)) return rol;
  }
  return null;
}

export async function setPin(rol: RolConPin, pin: string) {
  if (!/^\d{4,8}$/.test(pin)) {
    throw new Error("El PIN tiene que ser de 4 a 8 dígitos.");
  }
  // Un PIN repetido entre roles haría que el rol de menos permisos sea
  // inalcanzable: siempre ganaría el otro.
  const mapa = await mapaConfig();
  for (const otro of PRIORIDAD) {
    if (otro === rol) continue;
    const g = mapa.get(CLAVE_PIN[otro]);
    if (g && verificarHash(pin, g)) {
      throw new Error(`Ese PIN ya lo usa ${ETIQUETA_ROL[otro]}. Elegí otro.`);
    }
  }

  // Un solo hash: llamarlo dos veces generaba dos salts distintos y hacía el
  // trabajo de scrypt al doble.
  const valor = hashPin(pin);
  await db
    .insert(configuracion)
    .values({ clave: CLAVE_PIN[rol], valor })
    .onConflictDoUpdate({
      target: configuracion.clave,
      // El DEFAULT de actualizado_en solo aplica al INSERT. Sin esto, la
      // columna se quedaba con la fecha del primer alta y mentía sobre cuándo
      // se cambió el PIN de verdad.
      set: { valor, actualizadoEn: sql`now()` },
    });
}

/** Qué PINs están configurados, sin revelar nada de su contenido. */
export async function pinsConfigurados(): Promise<Record<RolConPin, boolean>> {
  const filas = await db.select({ clave: configuracion.clave }).from(configuracion);
  const claves = new Set(filas.map((f) => f.clave));
  return {
    jefe: claves.has("pin_jefe"),
    calidad: claves.has("pin_calidad"),
    admin: claves.has("pin_admin"),
  };
}

// ---------------------------------------------------------------------------
// Freno a la fuerza bruta.
//
// Un PIN de 4 dígitos son 10.000 combinaciones: un script las prueba todas en
// minutos. Esto va a estar en una URL pública, así que no es teórico.
// ---------------------------------------------------------------------------

const VENTANA_MIN = 15;
const MAX_INTENTOS = 8;

export async function estaBloqueado(origen: string): Promise<{
  bloqueado: boolean;
  esperaSeg: number;
}> {
  const [r] = await db
    .select({
      n: sql<number>`count(*)::int`,
      ultimo: sql<string | null>`max(${intentosPin.creadoEn})`,
    })
    .from(intentosPin)
    .where(
      and(
        eq(intentosPin.origen, origen),
        sql`${intentosPin.creadoEn} > now() - (${VENTANA_MIN} || ' minutes')::interval`
      )
    );

  const n = r?.n ?? 0;
  if (n < MAX_INTENTOS || !r?.ultimo) return { bloqueado: false, esperaSeg: 0 };

  // Espera creciente: 30s, 60s, 120s... con techo en la ventana completa.
  const espera = Math.min(30 * 2 ** (n - MAX_INTENTOS), VENTANA_MIN * 60);
  const restante = Math.ceil((Date.parse(r.ultimo) + espera * 1000 - Date.now()) / 1000);
  return restante > 0
    ? { bloqueado: true, esperaSeg: restante }
    : { bloqueado: false, esperaSeg: 0 };
}

export async function registrarFallo(origen: string) {
  await db.insert(intentosPin).values({ origen });
  // Limpieza oportunista: no hace falta un cron para esto.
  await db.delete(intentosPin).where(sql`${intentosPin.creadoEn} < now() - interval '1 day'`);
}

export async function limpiarIntentos(origen: string) {
  await db.delete(intentosPin).where(eq(intentosPin.origen, origen));
}

// ---------------------------------------------------------------------------
// Sesion: cookie httpOnly firmada con HMAC. Sin base de sesiones, sin libreria.
// ---------------------------------------------------------------------------
const DURACION_MS = 30 * 60 * 1000;

async function secreto(): Promise<string> {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;

  const [guardado] = await db
    .select()
    .from(configuracion)
    .where(eq(configuracion.clave, "session_secret"));
  if (guardado) return guardado.valor;

  const nuevo = crypto.randomBytes(32).toString("hex");
  // onConflictDoNothing por si dos instancias arrancan a la vez: en serverless
  // eso pasa, y sin esto una de las dos fallaria.
  await db
    .insert(configuracion)
    .values({ clave: "session_secret", valor: nuevo })
    .onConflictDoNothing();

  const [final] = await db
    .select()
    .from(configuracion)
    .where(eq(configuracion.clave, "session_secret"));
  return final?.valor ?? nuevo;
}

export async function firmarSesion(rol: Rol): Promise<string> {
  const payload = Buffer.from(JSON.stringify({ rol, exp: Date.now() + DURACION_MS })).toString(
    "base64url"
  );
  const firma = crypto.createHmac("sha256", await secreto()).update(payload).digest("base64url");
  return `${payload}.${firma}`;
}

export async function leerSesion(cookie: string | undefined): Promise<Rol | null> {
  if (!cookie) return null;
  const [payload, firma] = cookie.split(".");
  if (!payload || !firma) return null;

  const esperada = crypto
    .createHmac("sha256", await secreto())
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const { rol, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof exp !== "number" || Date.now() > exp) return null;
    if (rol !== "jefe" && rol !== "calidad" && rol !== "admin") return null;
    return rol;
  } catch {
    return null;
  }
}

export const COOKIE = "enplas_sesion";
