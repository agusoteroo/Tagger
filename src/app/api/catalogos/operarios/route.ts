import { body, entero, exigir, handler } from "@/lib/api";
import { bajaOperario, crearOperario, editarOperario } from "@/lib/catalogos";

export async function POST(req: Request) {
  return handler(async () => {
    const rol = await exigir("config");
    const b = await body<{ nombre: string }>(req);
    return crearOperario(b.nombre, rol);
  });
}

export async function PATCH(req: Request) {
  return handler(async () => {
    const rol = await exigir("config");
    const b = await body<{ id: number; nombre?: string; activo?: boolean }>(req);
    return editarOperario(entero(b.id, "id"), b, rol);
  });
}

// No siempre borra: si el operario ya produjo, lo desactiva. Ver catalogos.ts.
export async function DELETE(req: Request) {
  return handler(async () => {
    const rol = await exigir("config");
    const b = await body<{ id: number }>(req);
    return bajaOperario(entero(b.id, "id"), rol);
  });
}

export const dynamic = "force-dynamic";
