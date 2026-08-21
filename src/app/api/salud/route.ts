import { sql } from "drizzle-orm";
import { db } from "@/db";
import { prepararBase } from "@/db/arranque";

// Migraciones y (si se pide) siembra inicial, una sola vez por instancia.
let preparado: Promise<void> | null = null;

/**
 * GET /api/salud — chequeo de salud para Fly.
 *
 * No alcanza con responder 200: si la base no se puede leer, la app esta arriba
 * pero inservible. Asi que consulta de verdad.
 */
export async function GET() {
  try {
    preparado ??= prepararBase();
    await preparado;

    const filas = await db.execute<{ n: number }>(sql`select count(*)::int as n from etiquetas`);
    const n = Array.isArray(filas) ? filas[0]?.n : (filas as { rows?: { n: number }[] }).rows?.[0]?.n;
    return Response.json(
      { ok: true, etiquetas: n ?? 0, ts: new Date().toISOString() },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e) {
    console.error("[salud] la base no responde:", e);
    return Response.json({ ok: false, error: "base no disponible" }, { status: 503 });
  }
}

export const dynamic = "force-dynamic";
