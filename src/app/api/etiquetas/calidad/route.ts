import { body, exigir, handler } from "@/lib/api";
import { resolverCalidad } from "@/lib/etiquetas";

type Dictamen = { etiquetaIds: number[]; estado: "liberada" | "rechazada"; por: string; nota?: string };

// POST /api/etiquetas/calidad — liberar o rechazar en lote. Requiere PIN calidad.
export async function POST(req: Request) {
  return handler(async () => {
    await exigir("calidad");
    const b = await body<Dictamen>(req);
    return resolverCalidad({
      etiquetaIds: (b.etiquetaIds ?? []).map(Number),
      estado: b.estado === "rechazada" ? "rechazada" : "liberada",
      por: String(b.por ?? ""),
      nota: b.nota,
    });
  });
}

export const dynamic = "force-dynamic";
