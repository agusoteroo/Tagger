/**
 * Carga inicial. Datos de ejemplo para poder probar el flujo completo.
 * Es idempotente: se puede correr varias veces sin duplicar nada.
 *
 *   npm run db:seed
 */
import { eq } from "drizzle-orm";
import { cerrarConexion, db } from "./index";
import { migrar } from "./migrar";
import { frascos, maquinas, operarios, turnos } from "./schema";
import { setPin } from "../lib/auth";
import { abrirLote } from "../lib/lotes";

const FRASCOS = [
  { nombre: "Frasco 250ml PET", cantidadEstandar: 240, prefijoLote: "F250" },
  { nombre: "Frasco 500ml PET", cantidadEstandar: 120, prefijoLote: "F500" },
  { nombre: "Frasco 1L HDPE", cantidadEstandar: 60, prefijoLote: "F1L" },
  { nombre: "Pote 100g PP", cantidadEstandar: 400, prefijoLote: "P100" },
];

const OPERARIOS = ["Juan Pérez", "María González", "Carlos Sosa", "Lucía Ramírez"];
const TURNOS = ["Mañana", "Tarde", "Noche"];

const MAQUINAS = [
  // limite: lo que el jefe de planta cargaria al abrir el lote.
  { nombre: "Sopladora 1", frasco: "Frasco 250ml PET", limite: 12000, unidad: "unidades" as const },
  { nombre: "Sopladora 2", frasco: "Frasco 1L HDPE", limite: 40, unidad: "cajas" as const },
  { nombre: "Inyectora 1", frasco: "Pote 100g PP", limite: 20000, unidad: "unidades" as const },
];

async function main() {
  console.log("Aplicando migraciones...");
  await migrar();

  console.log("\nSembrando base...\n");

  for (const f of FRASCOS) await db.insert(frascos).values(f).onConflictDoNothing();
  console.log(`  frascos    ${FRASCOS.length}`);

  for (const nombre of OPERARIOS) {
    await db.insert(operarios).values({ nombre }).onConflictDoNothing();
  }
  console.log(`  operarios  ${OPERARIOS.length}`);

  for (const [i, nombre] of TURNOS.entries()) {
    await db.insert(turnos).values({ nombre, orden: i }).onConflictDoNothing();
  }
  console.log(`  turnos     ${TURNOS.length}`);

  for (const m of MAQUINAS) {
    const [frasco] = await db.select().from(frascos).where(eq(frascos.nombre, m.frasco));
    if (!frasco) throw new Error(`Falta el frasco ${m.frasco}`);
    await db
      .insert(maquinas)
      .values({ nombre: m.nombre, frascoId: frasco.id })
      .onConflictDoNothing();
  }
  console.log(`  maquinas   ${MAQUINAS.length}`);

  // Abrir un lote por maquina, si no tiene ya uno abierto.
  for (const m of MAQUINAS) {
    const [maq] = await db.select().from(maquinas).where(eq(maquinas.nombre, m.nombre));
    if (!maq) continue;
    if (maq.loteActualId) {
      console.log(`  lote       ${m.nombre}: ya tenía uno abierto, no lo toco`);
      continue;
    }
    const { lote } = await abrirLote({
      maquinaId: maq.id,
      limite: m.limite,
      limiteUnidad: m.unidad,
      actor: "seed",
    });
    console.log(`  lote       ${m.nombre} -> ${lote.codigo} (límite ${m.limite} ${m.unidad})`);
  }

  // PINs por defecto. HAY QUE CAMBIARLOS antes de poner esto en planta.
  await setPin("jefe", "3690");
  await setPin("calidad", "2468");
  await setPin("admin", "1357");
  console.log(`\n  PINs: jefe 3690 / calidad 2468 / admin 1357  -- CAMBIALOS en producción.`);

  console.log("\nListo.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => cerrarConexion());
