import { filtrosDeUrl } from "@/lib/filtros";
import { generarReporte } from "@/lib/reporte";

/**
 * GET /api/reporte?desde=&hasta=&operario=&maquina=&turno=
 *
 * Devuelve un HTML autocontenido para descargar. Un archivo, sin dependencias
 * externas: el cliente lo abre desde cualquier lado, sin internet y sin que la
 * PC de la planta tenga que estar prendida.
 *
 * Acepta los mismos filtros que el historial y las métricas, así el reporte
 * coincide con lo que se ve en pantalla.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const { html, nombreArchivo } = await generarReporte(filtrosDeUrl(u));

  // `inline` para poder previsualizarlo en una pestaña; `attachment` para bajarlo.
  const modo = u.searchParams.get("ver") === "1" ? "inline" : "attachment";

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `${modo}; filename="${nombreArchivo}"`,
      "cache-control": "no-store",
    },
  });
}

export const dynamic = "force-dynamic";
