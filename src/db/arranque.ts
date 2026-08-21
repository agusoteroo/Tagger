import { sql } from "drizzle-orm";
import { db } from "./index";
import { migrar } from "./migrar";
import { frascos, maquinas, operarios, turnos } from "./schema";
import { setPin } from "@/lib/auth";
import { prepararLote } from "@/lib/lotes";

/**
 * Preparacion de la base al arrancar: migraciones y, si se pide, siembra
 * inicial.
 *
 * En serverless no hay un "arranque" unico: cada instancia arranca por su
 * cuenta. Por eso esto tiene que ser idempotente y seguro de correr en
 * paralelo, y por eso la siembra nunca toca una base que ya tiene datos.
 */

const FRASCOS = [
  { nombre: "Frasco 250ml PET", cantidadEstandar: 240, prefijoLote: "F250" },
  { nombre: "Frasco 500ml PET", cantidadEstandar: 120, prefijoLote: "F500" },
  { nombre: "Frasco 1L HDPE", cantidadEstandar: 60, prefijoLote: "F1L" },
  { nombre: "Pote 100g PP", cantidadEstandar: 400, prefijoLote: "P100" },
];
const OPERARIOS = ["Juan Pérez", "María González", "Carlos Sosa", "Lucía Ramírez"];
const TURNOS = ["Mañana", "Tarde", "Noche"];
const MAQUINAS = [
  { nombre: "Sopladora 1", frasco: "Frasco 250ml PET", limite: 12000, unidad: "unidades" as const },
  { nombre: "Sopladora 2", frasco: "Frasco 1L HDPE", limite: 40, unidad: "cajas" as const },
  { nombre: "Inyectora 1", frasco: "Pote 100g PP", limite: 20000, unidad: "unidades" as const },
];

async function estaVacia() {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(maquinas);
  return (r?.n ?? 0) === 0;
}

export async function sembrarSiVacio() {
  if (process.env.SEMBRAR_SI_VACIO !== "1") return { sembrado: false, motivo: "desactivado" };
  if (!(await estaVacia())) return { sembrado: false, motivo: "la base ya tiene datos" };

  console.log("[arranque] base vacía, sembrando catálogos iniciales...");

  // onConflictDoNothing en todo: si dos instancias arrancan a la vez, la
  // segunda no falla.
  for (const f of FRASCOS) await db.insert(frascos).values(f).onConflictDoNothing();
  for (const nombre of OPERARIOS) await db.insert(operarios).values({ nombre }).onConflictDoNothing();
  for (const [i, nombre] of TURNOS.entries()) {
    await db.insert(turnos).values({ nombre, orden: i }).onConflictDoNothing();
  }

  const listaFrascos = await db.select().from(frascos);
  for (const m of MAQUINAS) {
    const frasco = listaFrascos.find((f) => f.nombre === m.frasco);
    if (!frasco) continue;
    await db
      .insert(maquinas)
      .values({ nombre: m.nombre, frascoId: frasco.id })
      .onConflictDoNothing();
  }

  const listaMaquinas = await db.select().from(maquinas);
  for (const m of MAQUINAS) {
    const maq = listaMaquinas.find((x) => x.nombre === m.nombre);
    if (!maq || maq.loteActualId) continue;
    await prepararLote({
      maquinaId: maq.id,
      limite: m.limite,
      limiteUnidad: m.unidad,
      actor: "arranque",
    });
  }

  // PINs iniciales. Se toman de las env vars si estan definidas, para no dejar
  // los del repo en una URL publica.
  const pins = {
    jefe: process.env.PIN_JEFE_INICIAL ?? "3690",
    calidad: process.env.PIN_CALIDAD_INICIAL ?? "2468",
    admin: process.env.PIN_ADMIN_INICIAL ?? "1357",
  };
  for (const [rol, pin] of Object.entries(pins) as ["jefe" | "calidad" | "admin", string][]) {
    try {
      await setPin(rol, pin);
    } catch (e) {
      console.error(`[arranque] no pude poner el PIN de ${rol}:`, e);
    }
  }

  const porDefecto = !process.env.PIN_ADMIN_INICIAL;
  console.log(
    `[arranque] listo: ${FRASCOS.length} frascos, ${OPERARIOS.length} operarios, ` +
      `${MAQUINAS.length} máquinas con lote abierto.` +
      (porDefecto ? " OJO: PINs por defecto, cambialos." : " PINs tomados de las env vars.")
  );

  return { sembrado: true, motivo: "base vacía" };
}

/** Migraciones + siembra. Una sola vez por instancia. */
export async function prepararBase() {
  await migrar();
  await sembrarSiVacio();
}
