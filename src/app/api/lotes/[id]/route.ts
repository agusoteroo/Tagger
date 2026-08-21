import { body, entero, exigir, handler } from "@/lib/api";
import { cancelarLotePreparado, cerrarLoteManual, editarLimite, type Unidad } from "@/lib/lotes";

// PATCH /api/lotes/:id — cerrar a mano, o corregir el límite.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const rol = await exigir("lotes");
    const { id } = await ctx.params;
    const loteId = entero(id, "id");
    const b = await body<{ accion: "cerrar" | "limite"; limite?: number; limiteUnidad?: Unidad }>(req);

    if (b.accion === "cerrar") return cerrarLoteManual({ loteId, actor: rol });

    return editarLimite({
      loteId,
      limite: entero(b.limite, "limite"),
      limiteUnidad: b.limiteUnidad === "cajas" ? "cajas" : "unidades",
      actor: rol,
    });
  });
}

// DELETE /api/lotes/:id — cancelar un lote que todavía no arrancó.
// No borra la fila: queda cerrado con motivo 'cancelado', así el hueco en la
// numeración queda explicado.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const rol = await exigir("lotes");
    const { id } = await ctx.params;
    return cancelarLotePreparado({ loteId: entero(id, "id"), actor: rol });
  });
}

export const dynamic = "force-dynamic";
