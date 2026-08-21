import { eq, sql } from "drizzle-orm";
import { cerrarConexion, db } from "@/db";
import { frascos, lotes, maquinas, operarios, turnos } from "@/db/schema";
import { prepararLote } from "@/lib/lotes";
import { requiereBaseDePrueba } from "./_requiere-postgres";

/**
 * Catalogo chico para que el cliente pruebe, hasta que lleguen los datos reales
 * de ENPLAS.
 *
 * Reemplaza los catalogos enteros. Las asignaciones maquina->frasco que habian
 * quedado estaban cruzadas por los tests (dos sopladoras apuntando al mismo
 * frasco), asi que no alcanza con agregar: hay que rehacerlas.
 *
 * Deja la planta en un estado que muestra las DOS mitades del flujo:
 *
 *   Sopladora 1  -> lote abierto con limite 20 cajas. Se puede etiquetar ya, y
 *                   el limite es chico a proposito: a las 20 cajas el lote se
 *                   cierra solo y arranca el siguiente, que es lo que hay que
 *                   ver funcionando.
 *   Sopladora 1  -> con un segundo lote PREPARADO en la cola, para que el cierre
 *                   automatico tenga a donde saltar sin que el jefe intervenga.
 *   Inyectora 1  -> sin lote. Aparece como maquina parada, y ahi se ve el
 *                   formulario de apertura del jefe.
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

  // Lote abierto en la primera maquina, con limite chico para que el cierre
  // automatico se pueda ver sin etiquetar 500 cajas.
  const [sopladora] = await db.select().from(maquinas).where(eq(maquinas.nombre, "Sopladora 1"));
  const abierto = await prepararLote({
    maquinaId: sopladora!.id,
    limite: 20,
    limiteUnidad: "cajas",
    actor: "catalogos-demo",
  });
  // Segundo lote en la cola: sin esto, al cerrarse el primero la maquina queda
  // parada y la linea espera al jefe. Es justo lo que la cola evita.
  const enCola = await prepararLote({
    maquinaId: sopladora!.id,
    limite: 20,
    limiteUnidad: "cajas",
    actor: "catalogos-demo",
  });

  // arrancoYa dice si el lote se abrio solo (la maquina estaba parada) o si
  // quedo esperando en la cola. Se informa lo que paso de verdad, no lo que
  // esperaba que pasara.
  const estado = (r: { arrancoYa: boolean }) => (r.arrancoYa ? "ABIERTO" : "en la cola");

  console.log(`\n  Sopladora 1  lote ${abierto.lote.codigo} ${estado(abierto)}, límite 20 cajas`);
  console.log(`  Sopladora 1  lote ${enCola.lote.codigo} ${estado(enCola)}`);
  console.log(`  Inyectora 1  sin lote (se ve el formulario de apertura del jefe)`);
}

main()
  .catch((e) => {
    console.error("FALLO:", e);
    process.exitCode = 1;
  })
  .finally(() => cerrarConexion());
