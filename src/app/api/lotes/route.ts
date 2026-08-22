import { body, entero, exigir, handler } from "@/lib/api";
import { listarLotes, abrirLote, type EstadoLote, type Unidad } from "@/lib/lotes";

// GET /api/lotes?estado=abierto — lista con progreso de cada lote.
export async function GET(req: Request) {
  const u = new URL(req.url);
  const e = u.searchParams.get("estado");
  const estado =
    e === "preparado" || e === "abierto" || e === "cerrado" ? (e as EstadoLote) : undefined;
  return handler(() =>
    listarLotes({
      estado,
      maquinaId: u.searchParams.get("maquinaId")
        ? Number(u.searchParams.get("maquinaId"))
        : undefined,
      limit: u.searchParams.get("limit") ? Number(u.searchParams.get("limit")) : undefined,
    })
  );
}

/**
 * POST /api/lotes — el formulario del jefe de planta.
 * Si la máquina no tiene lote abierto, este arranca ya. Si tiene, queda en cola
 * y arranca solo cuando el anterior llega a su límite.
 */
export async function POST(req: Request) {
  return handler(async () => {
    const rol = await exigir("lotes");
    const b = await body<{
      maquinaId: number;
      frascoId?: number;
      limite: number;
      limiteUnidad: Unidad;
      nota?: string;
    }>(req);
    return abrirLote({
      maquinaId: entero(b.maquinaId, "maquinaId"),
      frascoId: b.frascoId ? entero(b.frascoId, "frascoId") : undefined,
      limite: entero(b.limite, "limite"),
      limiteUnidad: b.limiteUnidad === "cajas" ? "cajas" : "unidades",
      nota: b.nota,
      actor: rol,
    });
  });
}

export const dynamic = "force-dynamic";
