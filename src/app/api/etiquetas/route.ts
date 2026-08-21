import { body, entero, handler } from "@/lib/api";
import { filtrosDeUrl } from "@/lib/filtros";
import { crearEtiqueta, listarEtiquetas } from "@/lib/etiquetas";

// GET /api/etiquetas — historial. Filtros: q, desde, hasta, operarioId,
// operario, maquina, turno, frasco, loteId, estado, soloAnuladas, incluirAnuladas.
export async function GET(req: Request) {
  const u = new URL(req.url);
  return handler(() =>
    listarEtiquetas({
      ...filtrosDeUrl(u),
      limit: u.searchParams.get("limit") ? Number(u.searchParams.get("limit")) : undefined,
      offset: u.searchParams.get("offset") ? Number(u.searchParams.get("offset")) : undefined,
    })
  );
}

// POST /api/etiquetas — generar una etiqueta.
// Sin PIN: el operario tiene que poder producir sin loguearse.
type Nueva = { maquinaId: number; operarioId: number; turno: string; cantidad: number };

export async function POST(req: Request) {
  return handler(async () => {
    const b = await body<Nueva>(req);
    return crearEtiqueta({
      maquinaId: entero(b.maquinaId, "maquinaId"),
      operarioId: entero(b.operarioId, "operarioId"),
      turno: String(b.turno ?? ""),
      cantidad: entero(b.cantidad, "cantidad"),
    });
  });
}

export const dynamic = "force-dynamic";
