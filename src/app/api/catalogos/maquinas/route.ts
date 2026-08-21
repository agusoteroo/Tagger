import { body, entero, exigir, handler } from "@/lib/api";
import { bajaMaquina, crearMaquina, editarMaquina } from "@/lib/catalogos";

export async function POST(req: Request) {
  return handler(async () => {
    const rol = await exigir("config");
    const b = await body<{ nombre: string; frascoId: number }>(req);
    return crearMaquina({ nombre: b.nombre, frascoId: entero(b.frascoId, "frascoId") }, rol);
  });
}

export async function PATCH(req: Request) {
  return handler(async () => {
    const rol = await exigir("config");
    const b = await body<{ id: number; nombre?: string; frascoId?: number; activa?: boolean }>(req);
    return editarMaquina(entero(b.id, "id"), b, rol);
  });
}

export async function DELETE(req: Request) {
  return handler(async () => {
    const rol = await exigir("config");
    const b = await body<{ id: number }>(req);
    return bajaMaquina(entero(b.id, "id"), rol);
  });
}

export const dynamic = "force-dynamic";
