import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { body, origen } from "@/lib/api";
import { COOKIE, estaBloqueado, firmarSesion, limpiarIntentos, registrarFallo, rolDePin } from "@/lib/auth";

// POST /api/auth/pin — valida el PIN EN EL SERVIDOR y devuelve solo el rol.
// El PIN nunca se compara en el navegador ni baja en ningún payload.
export async function POST(req: Request) {
  const quien = await origen();

  // Freno de fuerza bruta: 10.000 combinaciones de 4 dígitos se prueban en
  // minutos si no hay límite, y esto está en una URL pública.
  const bloqueo = await estaBloqueado(quien);
  if (bloqueo.bloqueado) {
    const min = Math.ceil(bloqueo.esperaSeg / 60);
    return NextResponse.json(
      {
        ok: false,
        error:
          bloqueo.esperaSeg > 90
            ? `Demasiados intentos. Probá de nuevo en ${min} ${min === 1 ? "minuto" : "minutos"}.`
            : `Demasiados intentos. Probá de nuevo en ${bloqueo.esperaSeg} segundos.`,
      },
      { status: 429 }
    );
  }

  const b = await body<{ pin: string }>(req).catch(() => ({ pin: "" }));
  const pin = String(b.pin ?? "");

  if (!/^\d{4,8}$/.test(pin)) {
    await registrarFallo(quien);
    return NextResponse.json({ ok: false, error: "PIN incorrecto." }, { status: 401 });
  }

  const rol = await rolDePin(pin);
  if (!rol) {
    await registrarFallo(quien);
    // Mensaje único: no se distingue "no existe" de "no alcanza".
    return NextResponse.json({ ok: false, error: "PIN incorrecto." }, { status: 401 });
  }

  await limpiarIntentos(quien);

  const c = await cookies();
  c.set(COOKIE, await firmarSesion(rol), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 60,
  });

  return NextResponse.json({ ok: true, data: { rol } });
}

export const dynamic = "force-dynamic";
