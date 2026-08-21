import { entero, handler, rolActual } from "@/lib/api";
import { registrarImpresion } from "@/lib/etiquetas";

// POST /api/etiquetas/:id/imprimir — cuenta la impresion y audita si es reimpresion.
// Cuando llegue la impresora, aca se agrega el envio del ZPL por TCP.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await ctx.params;
    const rol = await rolActual();
    return registrarImpresion(entero(id, "id"), rol);
  });
}

export const dynamic = "force-dynamic";
