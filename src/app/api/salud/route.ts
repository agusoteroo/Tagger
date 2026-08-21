import { sql } from "drizzle-orm";
import { db } from "@/db";
import { prepararBase } from "@/db/arranque";
import { ZONA, hoyLocal } from "@/lib/tiempo";

// Migraciones y (si se pide) siembra inicial, una sola vez por instancia.
let preparado: Promise<void> | null = null;

/**
 * GET /api/salud — chequeo de salud.
 *
 * No alcanza con responder 200: si la base no se puede leer, la app esta arriba
 * pero inservible. Asi que consulta de verdad.
 *
 * Tambien informa la zona horaria efectiva y el dia local que sale de ella.
 * Suena de mas, pero no lo es: las env vars marcadas "Sensitive" en Vercel no
 * se pueden volver a leer, ni por la CLI, asi que una TZ_PLANTA mal puesta era
 * invisible desde afuera. Un deploy se cayo justamente por eso. La zona no es
 * un secreto y ver que el dia local coincide con el de la planta es la unica
 * forma de comprobar que la variable llego bien.
 */
export async function GET() {
  try {
    preparado ??= prepararBase();
    await preparado;

    // Una sola consulta: dos viajes de red no hacen falta para esto.
    const filas = await db.execute<{ n: number; dia: string }>(
      sql`select (select count(*)::int from etiquetas) as n, ${hoyLocal()} as dia`
    );
    const fila = Array.isArray(filas)
      ? filas[0]
      : (filas as { rows?: { n: number; dia: string }[] }).rows?.[0];

    return Response.json(
      {
        ok: true,
        etiquetas: fila?.n ?? 0,
        zona: ZONA,
        // El dia local de la planta segun esa zona, calculado por Postgres.
        diaLocal: fila?.dia ?? null,
        ts: new Date().toISOString(),
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e) {
    console.error("[salud] la base no responde:", e);
    // El detalle va al log, no a la respuesta: el mensaje de una falla de
    // conexion puede incluir el host y el usuario de la base.
    return Response.json({ ok: false, error: "base no disponible" }, { status: 503 });
  }
}

export const dynamic = "force-dynamic";
