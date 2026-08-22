import { body, entero, exigir, handler } from "@/lib/api";
import { cerrarLoteManual, editarLimite, type Unidad } from "@/lib/lotes";

/**
 * PATCH /api/lotes/:id — cerrar a mano, o corregir el objetivo.
 *
 * Ya no hay DELETE. Servía para cancelar un lote que todavía no había arrancado,
 * y eso existía cuando los lotes esperaban en una cola. Ahora abrir un lote es
 * arrancarlo, así que no hay nada en estado "por arrancar" que cancelar: si se
 * cargó por error, se cierra a mano y se abre el correcto.
 */
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

export const dynamic = "force-dynamic";
