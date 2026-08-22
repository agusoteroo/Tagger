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

/**
 * Los PINs de fábrica, para poder AVISAR que siguen puestos.
 *
 * Están documentados en el repo, que es público, así que no son secretos: son
 * el valor inicial para que la app arranque usable. El riesgo real no es que se
 * conozcan, es que nadie se acuerde de cambiarlos. Por eso existe
 * `pinsPorDefecto()`: la pantalla de configuración avisa mientras alguno siga
 * siendo el de fábrica.
 *
 * Tenerlos acá y no en arranque.ts es a propósito: quien los pone y quien
 * detecta que siguen puestos tienen que leer la misma lista, o el aviso miente.
 */
export const PIN_POR_DEFECTO: Record<RolConPin, string> = {
  jefe: "3690",
  calidad: "2468",
  admin: "1357",
};

/**
 * Qué roles siguen con el PIN de fábrica.
 *
 * Se verifica contra el hash guardado, así que detecta el caso que importa:
 * alguien "cambió" el PIN y volvió a poner el mismo de siempre.
 */
export async function pinsPorDefecto(): Promise<RolConPin[]> {
  const mapa = await mapaConfig();
  const iguales: RolConPin[] = [];
  for (const rol of PRIORIDAD) {
    const guardado = mapa.get(CLAVE_PIN[rol]);
    if (guardado && verificarHash(PIN_POR_DEFECTO[rol], guardado)) iguales.push(rol);
  }
  return iguales;
}

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

/**
 * Techo GLOBAL, sumando todas las IPs.
 *
 * El límite por IP solo no alcanza desde que esto está en internet: un PIN de 4
 * dígitos son 10.000 combinaciones, y quien rote direcciones se lleva
 * MAX_INTENTOS gratis por cada una. Con suficientes IPs el PIN cae.
 *
 * Que esto sea seguro depende de una decisión de diseño que ya estaba tomada:
 * **el operario etiqueta sin PIN**. Así que frenar los intentos de PIN no para
 * la línea — el atacante no puede dejar la planta sin producir. Si etiquetar
 * necesitara PIN, este freno global sería un botón de apagado.
 *
 * Lo que sí puede hacer es dejar al jefe esperando un rato para abrir un lote.
 * Por eso el techo es holgado: 40 fallos en 15 minutos no los produce nadie
 * tipeando mal, y la espera no pasa de dos minutos.
 */
const MAX_GLOBAL = 40;
const ESPERA_GLOBAL_SEG = 120;

async function fallosEnVentana(origen?: string) {
  const dentroDeVentana = sql`${intentosPin.creadoEn} > now() - (${VENTANA_MIN} || ' minutes')::interval`;
  const [r] = await db
    .select({
      n: sql<number>`count(*)::int`,
      ultimo: sql<string | null>`max(${intentosPin.creadoEn})`,
    })
    .from(intentosPin)
    .where(origen ? and(eq(intentosPin.origen, origen), dentroDeVentana) : dentroDeVentana);
  return { n: r?.n ?? 0, ultimo: r?.ultimo ?? null };
}

function restanteDe(ultimo: string | null, esperaSeg: number) {
  if (!ultimo) return 0;
  return Math.ceil((Date.parse(ultimo) + esperaSeg * 1000 - Date.now()) / 1000);
}

export async function estaBloqueado(origen: string): Promise<{
  bloqueado: boolean;
  esperaSeg: number;
}> {
  const propio = await fallosEnVentana(origen);

  if (propio.n >= MAX_INTENTOS) {
    // Espera creciente: 30s, 60s, 120s... con techo en la ventana completa.
    const espera = Math.min(30 * 2 ** (propio.n - MAX_INTENTOS), VENTANA_MIN * 60);
    const restante = restanteDe(propio.ultimo, espera);
    if (restante > 0) return { bloqueado: true, esperaSeg: restante };
  }

  // Recién acá se mira el total. Es una consulta más, y solo hace falta cuando
  // la IP que pregunta todavía tiene crédito propio.
  const global = await fallosEnVentana();
  if (global.n >= MAX_GLOBAL) {
    const restante = restanteDe(global.ultimo, ESPERA_GLOBAL_SEG);
    if (restante > 0) return { bloqueado: true, esperaSeg: restante };
  }

  return { bloqueado: false, esperaSeg: 0 };
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
