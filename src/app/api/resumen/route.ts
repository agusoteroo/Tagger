import { handler } from "@/lib/api";
import { resumen } from "@/lib/etiquetas";

// GET /api/resumen — lo que consumen los dashboards remotos.
export async function GET() {
  return handler(() => resumen());
}

export const dynamic = "force-dynamic";
