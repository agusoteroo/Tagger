import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth";

// POST /api/auth/salir — bloquear la pantalla y volver a rol operario.
export async function POST() {
  const c = await cookies();
  c.delete(COOKIE);
  return NextResponse.json({ ok: true });
}

export const dynamic = "force-dynamic";
