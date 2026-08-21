import { body, exigir, handler } from "@/lib/api";
import { setPin } from "@/lib/auth";
import { ErrorNegocio } from "@/lib/errores";

// POST /api/config/pin — cambiar un PIN. Solo admin.
export async function POST(req: Request) {
  return handler(async () => {
    await exigir("config");
    const b = await body<{ rol: "calidad" | "admin"; pin: string }>(req);
    if (b.rol !== "calidad" && b.rol !== "admin") {
      throw new ErrorNegocio("Rol invalido: calidad o admin.");
    }
    try {
      setPin(b.rol, String(b.pin ?? ""));
    } catch (e) {
      throw new ErrorNegocio(e instanceof Error ? e.message : "PIN invalido.");
    }
    return { rol: b.rol, cambiado: true };
  });
}

export const dynamic = "force-dynamic";
