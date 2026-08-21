import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE, leerSesion, mensajeFalta, puede, type Permiso, type Rol } from "./auth";
import { ErrorNegocio } from "./errores";

export async function rolActual(): Promise<Rol> {
  const c = await cookies();
  return (await leerSesion(c.get(COOKIE)?.value)) ?? "operario";
}

/** Corta con 403 si el rol de la sesión no tiene ese permiso. */
export async function exigir(permiso: Permiso): Promise<Rol> {
  const rol = await rolActual();
  if (!puede(rol, permiso)) throw new ErrorNegocio(mensajeFalta(permiso), 403);
  return rol;
}

/**
 * Identifica al cliente para el freno de fuerza bruta.
 *
 * Detrás de Cloudflare Tunnel la IP real viene en CF-Connecting-IP; en la LAN
 * viene en x-forwarded-for o no viene. Si no hay nada, todos comparten el mismo
 * balde: es más restrictivo, y preferimos eso a no frenar nada.
 */
export async function origen(): Promise<string> {
  const h = await headers();
  return (
    h.get("cf-connecting-ip") ??
    h.get("x-real-ip") ??
    h.get("x-forwarded-for")?.split(",")[0].trim() ??
    "desconocido"
  );
}

/**
 * Envuelve un handler y traduce las excepciones a respuestas JSON.
 * Los errores inesperados NO se filtran al cliente: se loguean y se responde
 * un mensaje genérico.
 */
export function handler<T>(fn: () => Promise<T> | T) {
  return (async () => {
    try {
      return NextResponse.json({ ok: true, data: await fn() });
    } catch (e) {
      if (e instanceof ErrorNegocio) {
        return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
      }
      console.error("[api] error inesperado:", e);
      return NextResponse.json(
        { ok: false, error: "Error interno. Revisá el log del servidor." },
        { status: 500 }
      );
    }
  })();
}

export async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ErrorNegocio("El cuerpo del pedido no es JSON válido.");
  }
}

export function entero(v: unknown, campo: string): number {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new ErrorNegocio(`${campo} tiene que ser un número entero.`);
  return n;
}
