import { body, entero, exigir, handler } from "@/lib/api";
import { anularEtiqueta } from "@/lib/etiquetas";

// POST /api/etiquetas/:id/anular — no borra, marca. Requiere PIN admin.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    await exigir("anular");
    const { id } = await ctx.params;
    const b = await body<{ por: string; motivo: string }>(req);
    return anularEtiqueta({
      etiquetaId: entero(id, "id"),
      por: String(b.por ?? ""),
      motivo: String(b.motivo ?? ""),
    });
  });
}

export const dynamic = "force-dynamic";
