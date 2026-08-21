import { handler } from "@/lib/api";
import { filtrosDeUrl } from "@/lib/filtros";
import { DIMENSIONES, esDimension, porDimension, serieDiaria, totales } from "@/lib/metricas";

/**
 * GET /api/metricas?dim=operario&desde=2026-08-01&hasta=2026-08-20
 *
 * dim: operario | turno | maquina | frasco | dia | lote   (default: operario)
 * Acepta los mismos filtros que el historial, asi se puede cruzar:
 * ej. dim=operario&turno=Noche&maquina=Sopladora%201
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const pedida = u.searchParams.get("dim");
  return handler(async () => {
    const dim = esDimension(pedida) ? pedida : "operario";
    const f = filtrosDeUrl(u);

    // Las tres consultas son independientes: en paralelo, no una atras de otra.
    // Contra una base remota eso es la diferencia entre 3 viajes y 1.
    const [tot, filas, serie] = await Promise.all([
      totales(f),
      porDimension(dim, f),
      dim === "dia" ? Promise.resolve(undefined) : serieDiaria(f),
    ]);

    return {
      dimension: dim,
      dimensionesDisponibles: DIMENSIONES,
      filtros: f,
      totales: tot,
      filas,
      // La tendencia va siempre: es lo que se grafica arriba del tablero.
      serie,
    };
  });
}

export const dynamic = "force-dynamic";
