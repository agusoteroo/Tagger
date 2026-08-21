/**
 * Prueba que el número de caja no se pueda duplicar nunca.
 *
 *   npm run test:concurrencia     (necesita Postgres de verdad, no PGlite)
 *
 * Lanza varios PROCESOS escribiendo al mismo tiempo contra la misma base:
 * primero con la lógica del artifact original (para ver el bug), después con la
 * lógica nueva.
 *
 * Es el test que justifica la decisión de diseño más importante del sistema. En
 * SQLite la defensa era `BEGIN IMMEDIATE`; en Postgres es `UNIQUE(lote, caja)`
 * más reintento. Lo que se verifica es el resultado, no el mecanismo: cero
 * duplicados con procesos peleándose.
 */
import { spawn } from "node:child_process";
import { and, eq, sql } from "drizzle-orm";
import { cerrarConexion, db } from "../src/db";
import { etiquetas, lotes, maquinas, operarios } from "../src/db/schema";
import { cerrarLoteManual, prepararLote } from "../src/lib/lotes";
import { requierePostgres } from "./_requiere-postgres";

const PROCESOS = 6;
const POR_PROCESO = 20;
const TOTAL = PROCESOS * POR_PROCESO;

/** SQL crudo: devuelve las filas sin pasar por las funciones que se prueban. */
async function crudo<T = Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T[]> {
  const r = await db.execute(q);
  return (Array.isArray(r) ? r : ((r as { rows?: T[] }).rows ?? [])) as T[];
}

type Resultado = { ok: number; rechazos: number; error?: string };

/**
 * Devuelve lo que reporto cada worker.
 *
 * Antes esto descartaba stdout y solo mostraba stderr si el proceso salia con
 * codigo != 0. Los workers atrapan sus errores y salen con 0, asi que un worker
 * que no escribio NADA se veia igual que uno exitoso -- y el test decia
 * "grabadas 20 de 120" sin ninguna pista de por que.
 */
function correrWorkers(modo: "nuevo" | "viejo", maquinaId: number, operarioId: number) {
  const tareas = Array.from({ length: PROCESOS }, () => {
    return new Promise<Resultado>((resolve, reject) => {
      const p = spawn(
        process.platform === "win32" ? "npx.cmd" : "npx",
        [
          "tsx",
          // El sub-proceso tampoco lee .env.local por su cuenta.
          "--env-file-if-exists=.env.local",
          "scripts/worker-etiquetas.ts",
          modo,
          String(maquinaId),
          String(operarioId),
          String(POR_PROCESO),
        ],
        { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" }
      );
      let err = "";
      let out = "";
      p.stderr.on("data", (d) => (err += d.toString()));
      p.stdout.on("data", (d) => (out += d.toString()));
      p.on("close", (code) => {
        if (code !== 0) return reject(new Error(`worker salió con ${code}: ${err.slice(0, 400)}`));
        try {
          const r = JSON.parse(out.trim().split(/\r?\n/).filter(Boolean).pop() ?? "{}");
          resolve({ ok: r.ok ?? 0, rechazos: r.rechazos ?? 0, error: err.trim() || undefined });
        } catch {
          resolve({ ok: 0, rechazos: 0, error: (err || out).slice(0, 400) });
        }
      });
    });
  });
  return Promise.all(tareas);
}

/** Muestra que hizo cada worker. Sin esto, un worker que fallo pasa inadvertido. */
function resumirWorkers(rs: Resultado[]) {
  const ok = rs.reduce((a, r) => a + r.ok, 0);
  const rech = rs.reduce((a, r) => a + r.rechazos, 0);
  console.log(`  workers: ${rs.length}  |  escribieron ${ok}  |  rechazos ${rech}`);
  const conError = rs.filter((r) => r.error);
  if (conError.length) {
    console.log(`  ${conError.length} worker(s) reportaron errores:`);
    for (const r of conError.slice(0, 2)) {
      console.log(`    ok=${r.ok} rechazos=${r.rechazos}`);
      console.log(`    ${r.error!.replace(/\s+/g, " ").slice(0, 400)}`);
    }
  }
  console.log("");
}

async function main() {
  requierePostgres("test:concurrencia");

  const [op] = await db.select().from(operarios).limit(1);
  const [maq] = await db.select().from(maquinas).limit(1);
  if (!op || !maq) throw new Error("Corré primero: npm run db:seed");

  // =========================================================================
  // PARTE 1 — el bug original
  // =========================================================================
  console.log("=".repeat(66));
  console.log("PARTE 1  Lógica del artifact original (contador en el cliente)");
  console.log("=".repeat(66));

  // Tabla sin restricción UNIQUE, a propósito: es lo que permite ver el bug.
  await db.execute(sql`drop table if exists demo_viejo_etiquetas`);
  await db.execute(sql`drop table if exists demo_viejo_contador`);
  await db.execute(
    sql`create table demo_viejo_contador (lote_id integer primary key, valor integer not null)`
  );
  await db.execute(
    sql`create table demo_viejo_etiquetas (id serial primary key, lote_id integer, caja integer)`
  );
  await db.execute(
    sql`insert into demo_viejo_contador (lote_id, valor) values (${maq.id}, 0)`
  );

  console.log(`\n  ${PROCESOS} procesos x ${POR_PROCESO} etiquetas = ${TOTAL} cajas esperadas\n`);
  await correrWorkers("viejo", maq.id, op.id);

  const dupViejo = await crudo<{ caja: number; n: number }>(sql`
    select caja, count(*)::int as n from demo_viejo_etiquetas
    where lote_id = ${maq.id} group by caja having count(*) > 1 order by caja`);
  const [{ total: totalViejo, distintos: distintosViejo }] = await crudo<{
    total: number;
    distintos: number;
  }>(sql`
    select count(*)::int as total, count(distinct caja)::int as distintos
    from demo_viejo_etiquetas where lote_id = ${maq.id}`);

  console.log(`  cajas grabadas .......... ${totalViejo}`);
  console.log(`  números distintos ....... ${distintosViejo}`);
  console.log(`  números DUPLICADOS ...... ${dupViejo.length}`);
  if (dupViejo.length) {
    const muestra = dupViejo
      .slice(0, 8)
      .map((d) => `#${d.caja} x${d.n}`)
      .join("  ");
    console.log(`  ejemplos ................ ${muestra}${dupViejo.length > 8 ? "  ..." : ""}`);
    console.log(
      `\n  >> ${totalViejo - distintosViejo} cajas comparten número con otra. En planta eso`
    );
    console.log(`     significa dos cajas físicas distintas con la misma etiqueta.`);
  } else {
    console.log(`\n  >> Esta vez no se duplicó. Es una carrera: depende del timing.`);
    console.log(`     Que no falle en una prueba no significa que sea seguro.`);
  }

  await db.execute(sql`drop table demo_viejo_etiquetas`);
  await db.execute(sql`drop table demo_viejo_contador`);

  // =========================================================================
  // PARTE 2 — el sistema nuevo
  // =========================================================================
  console.log("\n" + "=".repeat(66));
  console.log("PARTE 2  Sistema nuevo (UNIQUE(lote, caja) + reintento)");
  console.log("=".repeat(66));

  // Cerrar lo que esté abierto en esta máquina. Si no, el lote de prueba
  // quedaría EN COLA y las etiquetas irían al lote viejo hasta que ese llegue a
  // su límite — que es justo lo que pasó la primera vez que corrimos esto.
  let abierto = (
    await db
      .select()
      .from(lotes)
      .where(and(eq(lotes.maquinaId, maq.id), eq(lotes.estado, "abierto")))
      .limit(1)
  )[0];
  while (abierto) {
    await cerrarLoteManual({ loteId: abierto.id, actor: "test" });
    console.log(`  cerrado el lote que estaba abierto (${abierto.codigo})`);
    abierto = (
      await db
        .select()
        .from(lotes)
        .where(and(eq(lotes.maquinaId, maq.id), eq(lotes.estado, "abierto")))
        .limit(1)
    )[0];
  }

  // Límite muy alto a propósito: este test mide la numeración de cajas, no el
  // cierre por límite (eso lo cubre test:lotes).
  const { lote, arrancoYa } = await prepararLote({
    maquinaId: maq.id,
    limite: 1_000_000,
    limiteUnidad: "unidades",
    actor: "test",
  });
  if (!arrancoYa) throw new Error("El lote de prueba quedó en cola: la máquina tenía otro abierto.");
  console.log(`\n  lote de prueba: ${lote.codigo} (id ${lote.id})`);
  console.log(`  ${PROCESOS} procesos x ${POR_PROCESO} etiquetas = ${TOTAL} cajas esperadas\n`);

  const t0 = process.hrtime.bigint();
  resumirWorkers(await correrWorkers("nuevo", maq.id, op.id));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  const dup = await crudo<{ caja: number; n: number }>(sql`
    select caja, count(*)::int as n from etiquetas
    where lote_id = ${lote.id} group by caja having count(*) > 1`);
  const [{ total, minimo, maximo }] = await crudo<{
    total: number;
    minimo: number;
    maximo: number;
  }>(sql`
    select count(*)::int as total, coalesce(min(caja), 0)::int as minimo,
           coalesce(max(caja), 0)::int as maximo
    from etiquetas where lote_id = ${lote.id}`);

  console.log(`  cajas grabadas .......... ${total}`);
  console.log(`  rango de números ........ #${minimo} a #${maximo}`);
  console.log(`  números DUPLICADOS ...... ${dup.length}`);
  const huecos = maximo - minimo + 1 - total;
  console.log(`  huecos en la secuencia .. ${huecos}`);
  console.log(
    `  tiempo .................. ${ms.toFixed(0)} ms  (${(total / (ms / 1000)).toFixed(0)} etiquetas/s)`
  );

  const perfecto = dup.length === 0 && total === TOTAL && huecos === 0 && minimo === 1;
  console.log("\n" + "-".repeat(66));
  if (perfecto) {
    console.log(`OK  ${total} cajas numeradas 1..${TOTAL}, sin duplicados y sin huecos,`);
    console.log(`    con ${PROCESOS} procesos escribiendo en simultáneo.`);
  } else {
    console.log(
      `FALLO  esperadas ${TOTAL}, grabadas ${total}, duplicados ${dup.length}, huecos ${huecos}`
    );
    process.exitCode = 1;
  }
  console.log("-".repeat(66));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => cerrarConexion());
