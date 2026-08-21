import { body, entero, exigir, handler } from "@/lib/api";
import { bajaTurno, crearTurno } from "@/lib/catalogos";

export async function POST(req: Request) {
  return handler(async () => {
    const rol = await exigir("config");
    const b = await body<{ nombre: string }>(req);
    return crearTurno(b.nombre, rol);
  });
}

export async function DELETE(req: Request) {
  return handler(async () => {
    const rol = await exigir("config");
    const b = await body<{ id: number }>(req);
    return bajaTurno(entero(b.id, "id"), rol);
  });
}

export const dynamic = "force-dynamic";
