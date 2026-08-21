import { sql } from "drizzle-orm";
import { db, motorActual, poolActual } from "@/db";
import { diagnosticarRed } from "@/lib/diagnostico-red";
import { conLimite } from "@/lib/limite-tiempo";
import { ZONA, hoyLocal } from "@/lib/tiempo";

/**
 * GET /api/salud — chequeo de salud.
 *
 * NO corre migraciones. Antes si, y estaba mal por dos razones:
 *
 * 1. En serverless no hay un arranque unico. Cada instancia fria corria el
 *    migrador, o sea DDL desde una peticion HTTP, varias a la vez. Eso venia de
 *    cuando esto iba a un contenedor largo en Fly, donde migrar al arrancar si
 *    tenia sentido.
 * 2. La carpeta drizzle/ con los .sql no viaja al bundle de la funcion: nada
 *    en el codigo la importa, asi que el trazado de Next no la incluye. El
 *    migrador buscaba archivos que no estaban ahi.
 *
 * Las migraciones se aplican al desplegar, con `npm run db:migrar`, contra la
 * base y desde afuera. Este endpoint solo comprueba que la base responda.
 *
 * Tambien informa la zona horaria efectiva: las env vars marcadas Sensitive en
 * Vercel no se pueden volver a leer, ni por la CLI, asi que una TZ_PLANTA mal
 * puesta era invisible desde afuera (y tumbo un deploy). La zona no es secreta.
 */

/** Presupuesto propio, bien por debajo del maximo de la funcion. */
const MS_LIMITE = 8000;

export async function GET(pedido: Request) {
  const arranque = Date.now();

  /**
   * ?diag=1 -> diagnostico de red paso por paso (dns, tcp, handshake de
   * Postgres) en vez de la consulta. No devuelve credenciales, solo host,
   * puerto y que paso en cada tramo. Es la unica forma de distinguir "no
   * resuelve el nombre" de "no hay ruta" de "la consulta es lenta" cuando lo
   * unico que se ve desde afuera es que la peticion no vuelve.
   */
  if (new URL(pedido.url).searchParams.get("diag") === "1") {
    const pasos = await diagnosticarRed(process.env.DATABASE_URL);
    return Response.json(
      { ok: pasos.every((p) => p.ok), zona: ZONA, region: process.env.VERCEL_REGION ?? null, pasos },
      { status: pasos.every((p) => p.ok) ? 200 : 503, headers: { "cache-control": "no-store" } }
    );
  }
  try {
    // Una sola consulta: el conteo y el dia local en el mismo viaje.
    const filas = await conLimite("consulta a la base", MS_LIMITE, () =>
      db.execute<{ n: number; dia: string }>(
        sql`select (select count(*)::int from etiquetas) as n, ${hoyLocal()} as dia`
      )
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
        motor: motorActual(),
        // Se informa a proposito: un pool de cero conexiones no da error,
        // encola para siempre, y desde afuera se ve igual que una base caida.
        pool: poolActual(),
        ms: Date.now() - arranque,
        region: process.env.VERCEL_REGION ?? null,
        ts: new Date().toISOString(),
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    console.error(`[salud] fallo tras ${Date.now() - arranque} ms:`, e);
    return Response.json(
      {
        ok: false,
        // El detalle SI va en la respuesta de este endpoint. Es el unico que lo
        // hace, y es a proposito: sin esto, diagnosticar una base que no
        // responde en produccion es a ciegas. No incluye la cadena de conexion
        // porque el mensaje del driver no la trae; si algun dia la trajera,
        // esto habria que recortarlo.
        error: detalle.slice(0, 300),
        zona: ZONA,
        ms: Date.now() - arranque,
        region: process.env.VERCEL_REGION ?? null,
      },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
}

export const dynamic = "force-dynamic";

/**
 * Techo de la funcion. El default de Vercel dejo que una peticion colgada
 * quemara 300 segundos; un chequeo de salud que tarda 15 ya es una falla.
 */
export const maxDuration = 30;
