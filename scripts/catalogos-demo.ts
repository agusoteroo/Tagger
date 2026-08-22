import { eq, sql } from "drizzle-orm";
import { cerrarConexion, db } from "@/db";
import { frascos, lotes, maquinas, operarios, turnos } from "@/db/schema";
import { abrirLote } from "@/lib/lotes";
import { requiereBaseDePrueba } from "./_requiere-postgres";

/**
 * Catalogo chico para que el cliente pruebe, hasta que lleguen los datos reales
 * de ENPLAS.
 *
 * Reemplaza los catalogos enteros. Las asignaciones maquina->frasco que habian
 * quedado estaban cruzadas por los tests (dos sopladoras apuntando al mismo
 * frasco), asi que no alcanza con agregar: hay que rehacerlas.
 *
 * Deja la planta en un estado que muestra las dos mitades del flujo:
 *
 *   Sopladora 1  -> lote abierto de frascos, objetivo 20 cajas. Se puede
 *                   etiquetar ya. El objetivo es chico a proposito: a las 20
 *                   cajas se ve lo que importa entender, que el lote NO se
 *                   cierra y la maquina sigue produciendo.
 *   Inyectora 1  -> sin lote. Aparece como maquina parada, y ahi se ve el
 *                   formulario de apertura del jefe.
 *
 * Y desde ahi se puede probar el cierre de verdad: abrir un lote de OTRO
 * producto en la Sopladora 1 cierra el de frascos en ese momento, con el
 * porcentaje que llevaba.
 *
 * Solo corre contra una base de prueba, o con BASE_DE_PRUEBA=si.
 */

const FRASCOS = [
  { nombre: "Frasco 250 ml PET", cantidadEstandar: 240, prefijoLote: "F250" },
  { nombre: "Frasco 500 ml PET", cantidadEstandar: 120, prefijoLote: "F500" },
  { nombre: "Pote 100 g PP", cantidadEstandar: 400, prefijoLote: "P100" },
];

const OPERARIOS = ["Juan Pérez", "María González", "Carlos Sosa"];

const TURNOS = [
  { nombre: "Mañana", orden: 0 },
  { nombre: "Tarde", orden: 1 },
  { nombre: "Noche", orden: 2 },
];

// La maquina y que produce hoy. El jefe lo cambia cuando abre un lote de otro
// producto; esto es solo el estado inicial.
const MAQUINAS = [
  { nombre: "Sopladora 1", frasco: "Frasco 250 ml PET" },
  { nombre: "Inyectora 1", frasco: "Pote 100 g PP" },
];

async function main() {
  requiereBaseDePrueba("db:catalogos-demo");

  const [{ n }] = await db
    .select({ n: sql<number>`(select count(*)::int from etiquetas)` })
    .from(sql`(select 1) as x`);
  if (n > 0) {
    console.error(
      `\nLa base tiene ${n} etiquetas. Este script rehace los catalogos, y eso\n` +
        `dejaria etiquetas apuntando a frascos y operarios que ya no existen.\n\n` +
        `Corré primero:  CONFIRMO=si npm run db:limpiar\n`
    );
    process.exitCode = 1;
    return;
  }

  console.log("Rehaciendo catálogos...\n");

  // Se borra y se reinserta en vez de actualizar: los tests dejaron
  // asignaciones cruzadas, y adivinar cual estaba bien es mas fragil que
  // partir de cero. Sin etiquetas ni lotes, nada apunta a esto.
  await db.transaction(async (tx) => {
    await tx.update(maquinas).set({ loteActualId: null });
    await tx.delete(lotes);
    await tx.delete(maquinas);
    await tx.delete(frascos);
    await tx.delete(operarios);
    await tx.delete(turnos);
    for (const t of ["lotes", "maquinas", "frascos", "operarios", "turnos"]) {
      await tx.execute(sql.raw(`alter sequence if exists ${t}_id_seq restart with 1`));
    }

    await tx.insert(frascos).values(FRASCOS);
    await tx.insert(operarios).values(OPERARIOS.map((nombre) => ({ nombre })));
    await tx.insert(turnos).values(TURNOS);

    const lista = await tx.select().from(frascos);
    await tx.insert(maquinas).values(
      MAQUINAS.map((m) => ({
        nombre: m.nombre,
        frascoId: lista.find((f) => f.nombre === m.frasco)!.id,
      }))
    );
  });

  for (const f of FRASCOS) {
    console.log(`  frasco    ${f.nombre.padEnd(20)} ${String(f.cantidadEstandar).padStart(4)} u./caja   ${f.prefijoLote}`);
  }
  for (const o of OPERARIOS) console.log(`  operario  ${o}`);
  for (const t of TURNOS) console.log(`  turno     ${t.nombre}`);

  /**
   * Un solo lote abierto, con objetivo chico.
   *
   * Antes acá se abrían dos: uno activo y uno en cola, porque el lote se cerraba
   * solo al llegar al límite y sin cola la línea quedaba parada. Ya no hay cola:
   * cargar un lote es arrancarlo, y el que estaba se cierra ahí mismo. Abrir dos
   * seguidos dejaría el primero cerrado con 0 cajas, que no le sirve a nadie
   * como punto de partida.
   *
   * El objetivo de 20 cajas es para que se pueda ver sin etiquetar 500: a la
   * caja 20 la pantalla dice "objetivo cumplido" y sigue aceptando cajas.
   */
  const [sopladora] = await db.select().from(maquinas).where(eq(maquinas.nombre, "Sopladora 1"));
  const abierto = await abrirLote({
    maquinaId: sopladora!.id,
    limite: 20,
    limiteUnidad: "cajas",
    actor: "catalogos-demo",
  });

  console.log(`\n  Sopladora 1  lote ${abierto.lote.codigo} abierto, objetivo 20 cajas`);
  console.log(`  Inyectora 1  sin lote (se ve el formulario de apertura del jefe)`);
  console.log(`\n  Para ver el cierre: abrí un lote de otro producto en la Sopladora 1.`);
}

main()
  .catch((e) => {
    console.error("FALLO:", e);
    process.exitCode = 1;
  })
  .finally(() => cerrarConexion());
