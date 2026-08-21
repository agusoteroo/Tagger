/**
 * Prueba que el numero de caja no se pueda duplicar nunca.
 *
 *   npm run test:concurrencia
 *
 * Lanza varios PROCESOS de verdad escribiendo al mismo tiempo sobre el mismo
 * archivo SQLite, primero con la logica del artifact original (para ver el bug)
 * y despues con la logica nueva.
 */
import { spawn } from "node:child_process";
import { and, eq, sql } from "drizzle-orm";
import { db, raw } from "../src/db";
import { etiquetas, lotes, maquinas, operarios } from "../src/db/schema";
import { cerrarLoteManual, prepararLote } from "../src/lib/lotes";

const PROCESOS = 6;
const POR_PROCESO = 20;
const TOTAL = PROCESOS * POR_PROCESO;

function correrWorkers(modo: "nuevo" | "viejo", maquinaId: number, operarioId: number) {
  const tareas = Array.from({ length: PROCESOS }, () => {
    return new Promise<void>((resolve, reject) => {
      const p = spawn(
        process.platform === "win32" ? "npx.cmd" : "npx",
        ["tsx", "scripts/worker-etiquetas.ts", modo, String(maquinaId), String(operarioId), String(POR_PROCESO)],
        { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" }
      );
      let err = "";
      p.stderr.on("data", (d) => (err += d.toString()));
      p.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`worker salio con ${code}: ${err.slice(0, 400)}`));
      });
    });
  });
  return Promise.all(tareas);
}

async function main() {
  const op = db.select().from(operarios).limit(1).get();
  const maq = db.select().from(maquinas).limit(1).get();
  if (!op || !maq) throw new Error("Corre primero: npm run db:seed");

  // =========================================================================
  // PARTE 1 — el bug original
  // =========================================================================
  console.log("=".repeat(66));
  console.log(`PARTE 1  Logica del artifact original (contador en el cliente)`);
  console.log("=".repeat(66));

  raw.exec(`
    DROP TABLE IF EXISTS demo_viejo_etiquetas;
    DROP TABLE IF EXISTS demo_viejo_contador;
    CREATE TABLE demo_viejo_contador (lote_id INTEGER PRIMARY KEY, valor INTEGER NOT NULL);
    CREATE TABLE demo_viejo_etiquetas (id INTEGER PRIMARY KEY AUTOINCREMENT, lote_id INTEGER, caja INTEGER);
  `);
  raw.prepare("INSERT INTO demo_viejo_contador (lote_id, valor) VALUES (?, 0)").run(maq.id);

  console.log(`\n  ${PROCESOS} procesos x ${POR_PROCESO} etiquetas = ${TOTAL} cajas esperadas\n`);
  await correrWorkers("viejo", maq.id, op.id);

  const dupViejo = raw
    .prepare(
      `SELECT caja, COUNT(*) n FROM demo_viejo_etiquetas
       WHERE lote_id = ? GROUP BY caja HAVING n > 1 ORDER BY caja`
    )
    .all(maq.id) as { caja: number; n: number }[];
  const totalViejo = (
    raw.prepare("SELECT COUNT(*) n FROM demo_viejo_etiquetas WHERE lote_id = ?").get(maq.id) as {
      n: number;
    }
  ).n;
  const distintosViejo = (
    raw
      .prepare("SELECT COUNT(DISTINCT caja) n FROM demo_viejo_etiquetas WHERE lote_id = ?")
      .get(maq.id) as { n: number }
  ).n;

  console.log(`  cajas grabadas .......... ${totalViejo}`);
  console.log(`  numeros distintos ....... ${distintosViejo}`);
  console.log(`  numeros DUPLICADOS ...... ${dupViejo.length}`);
  if (dupViejo.length) {
    const muestra = dupViejo.slice(0, 8).map((d) => `#${d.caja} x${d.n}`).join("  ");
    console.log(`  ejemplos ................ ${muestra}${dupViejo.length > 8 ? "  ..." : ""}`);
    const cajasPerdidas = totalViejo - distintosViejo;
    console.log(`\n  >> ${cajasPerdidas} cajas comparten numero con otra. En planta eso significa`);
    console.log(`     dos cajas fisicas distintas con la misma etiqueta.`);
  } else {
    console.log(`\n  >> Esta vez no se duplico. Es una carrera: depende del timing.`);
    console.log(`     Que no falle en una prueba no significa que sea seguro.`);
  }

  raw.exec("DROP TABLE demo_viejo_etiquetas; DROP TABLE demo_viejo_contador;");

  // =========================================================================
  // PARTE 2 — el sistema nuevo
  // =========================================================================
  console.log("\n" + "=".repeat(66));
  console.log(`PARTE 2  Sistema nuevo (transaccion IMMEDIATE + UNIQUE(lote,caja))`);
  console.log("=".repeat(66));

  // Cerrar lo que este abierto en esta maquina. Si no, el lote de prueba
  // quedaria EN COLA y las etiquetas irian al lote viejo hasta que ese llegue
  // a su limite -- que es justo lo que paso la primera vez que corrimos esto.
  const abierto = db
    .select()
    .from(lotes)
    .where(and(eq(lotes.maquinaId, maq.id), eq(lotes.estado, "abierto")))
    .get();
  if (abierto) {
    cerrarLoteManual({ loteId: abierto.id, actor: "test" });
    console.log(`\n  cerrado el lote que estaba abierto (${abierto.codigo})`);
    // cerrarLoteManual activa el siguiente de la cola: hay que vaciarla.
    let sig = db
      .select()
      .from(lotes)
      .where(and(eq(lotes.maquinaId, maq.id), eq(lotes.estado, "abierto")))
      .get();
    while (sig) {
      cerrarLoteManual({ loteId: sig.id, actor: "test" });
      sig = db
        .select()
        .from(lotes)
        .where(and(eq(lotes.maquinaId, maq.id), eq(lotes.estado, "abierto")))
        .get();
    }
  }

  // Limite muy alto a proposito: este test mide la numeracion de cajas, no el
  // cierre por limite (eso lo cubre test:lotes).
  const { lote, arrancoYa } = prepararLote({
    maquinaId: maq.id,
    limite: 1_000_000,
    limiteUnidad: "unidades",
    actor: "test",
  });
  if (!arrancoYa) throw new Error("El lote de prueba quedo en cola: la maquina tenia otro abierto.");
  console.log(`\n  lote de prueba: ${lote.codigo} (id ${lote.id})`);
  console.log(`  ${PROCESOS} procesos x ${POR_PROCESO} etiquetas = ${TOTAL} cajas esperadas\n`);

  const t0 = process.hrtime.bigint();
  await correrWorkers("nuevo", maq.id, op.id);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  const dup = db
    .select({ caja: etiquetas.caja, n: sql<number>`count(*)` })
    .from(etiquetas)
    .where(eq(etiquetas.loteId, lote.id))
    .groupBy(etiquetas.caja)
    .having(sql`count(*) > 1`)
    .all();

  const total = db
    .select({ n: sql<number>`count(*)` })
    .from(etiquetas)
    .where(eq(etiquetas.loteId, lote.id))
    .get()!.n;

  const rango = db
    .select({ min: sql<number>`min(${etiquetas.caja})`, max: sql<number>`max(${etiquetas.caja})` })
    .from(etiquetas)
    .where(eq(etiquetas.loteId, lote.id))
    .get()!;

  console.log(`  cajas grabadas .......... ${total}`);
  console.log(`  rango de numeros ........ #${rango.min} a #${rango.max}`);
  console.log(`  numeros DUPLICADOS ...... ${dup.length}`);
  const huecos = rango.max - rango.min + 1 - total;
  console.log(`  huecos en la secuencia .. ${huecos}`);
  console.log(`  tiempo .................. ${ms.toFixed(0)} ms  (${(total / (ms / 1000)).toFixed(0)} etiquetas/s)`);

  const perfecto = dup.length === 0 && total === TOTAL && huecos === 0 && rango.min === 1;
  console.log("\n" + "-".repeat(66));
  if (perfecto) {
    console.log(`OK  ${total} cajas numeradas 1..${TOTAL}, sin duplicados y sin huecos,`);
    console.log(`    con ${PROCESOS} procesos escribiendo en simultaneo.`);
  } else {
    console.log(`FALLO  esperadas ${TOTAL}, grabadas ${total}, duplicados ${dup.length}, huecos ${huecos}`);
    process.exitCode = 1;
  }
  console.log("-".repeat(66));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
