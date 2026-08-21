import { body, entero, exigir, handler } from "@/lib/api";
import { crearFrasco, editarFrasco } from "@/lib/catalogos";

export async function POST(req: Request) {
  return handler(async () => {
    const rol = await exigir("config");
    const b = await body<{ nombre: string; cantidadEstandar?: number | null }>(req);
    return crearFrasco(b, rol);
  });
}

export async function PATCH(req: Request) {
  return handler(async () => {
    const rol = await exigir("config");
    const b = await body<{ id: number; nombre?: string; cantidadEstandar?: number | null; activo?: boolean }>(req);
    return editarFrasco(entero(b.id, "id"), b, rol);
  });
}

export const dynamic = "force-dynamic";
