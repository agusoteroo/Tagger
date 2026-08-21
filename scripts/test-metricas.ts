/**
 * Verifica las agregaciones de eficiencia contra SQL escrito a mano.
 *
 *   npm run test:metricas
 *
 * No compara la función consigo misma: cada número se recalcula con una
 * consulta independiente. Si porDimension() tuviera un bug, esto lo agarra.
 *
 * Y verifica lo más delicado de la migración a Postgres: que agrupar "por día"
 * use el día LOCAL de la planta y no el UTC. Con el turno noche cruzando la
 * medianoche, esa diferencia mueve cientos de etiquetas de día.
 */
import { sql } from "drizzle-orm";
import { cerrarConexion, db } from "../src/db";
import { etiquetas, lotes, operarios } from "../src/db/schema";
import { migrar } from "../src/db/migrar";
import { porDimension, serieDiaria, totales } from "../src/lib/metricas";
import { ZONA } from "../src/lib/tiempo";
import { requiereBaseDePrueba } from "./_requiere-postgres";

let fallas = 0;
function ok(nombre: string, cond: boolean, extra = "") {
  console.log(`  ${cond ? "OK   " : "FALLA"} ${nombre}${extra ? "  -> " + extra : ""}`);
  if (!cond) fallas++;
}

/** Ejecuta SQL crudo y devuelve las filas, sin pasar por las funciones a probar. */
async function crudo<T = Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T[]> {
  const r = await db.execute(q);
  // postgres.js devuelve un array; PGlite devuelve { rows }.
  return (Array.isArray(r) ? r : ((r as { rows?: T[] }).rows ?? [])) as T[];
}

/**
 * Fixture propio: producción repartida en varios días LOCALES, incluyendo cajas
 * del turno noche que en UTC caen al día siguiente.
 *
 * Sin eso el chequeo de zona horaria no probaría nada, porque UTC y local
 * darían lo mismo. Y el test no puede depender de que alguien haya corrido
 * `db:demo` antes.
 */
async function asegurarFixture() {
  const [{ n }] = await crudo<{ n: number }>(
    sql`select count(distinct (creado_en at time zone ${ZONA})::date)::int as n
        from etiquetas where anulada = false`
  );
  if (n >= 3) return false;

  const [lote] = await db.select().from(lotes).orderBy(sql`id desc`).limit(1);
  const ops = await db.select().from(operarios).limit(2);
  if (!lote || !ops.length) throw new Error("Corré primero: npm run db:seed");

  const [{ m }] = await crudo<{ m: number }>(
    sql`select coalesce(max(caja), 0)::int as m from etiquetas where lote_id = ${lote.id}`
  );
  let caja = m + 1;

  // Se insertan con hora LOCAL explícita y Postgres la convierte: así el
  // fixture no depende de la zona del proceso que corre el test.
  for (let d = 5; d >= 1; d--) {
    for (const [horaLocal, turno, quien] of [
      [8, "Mañana", ops[0]],
      [22, "Noche", ops[1] ?? ops[0]],
    ] as const) {
      for (let i = 0; i < 4; i++) {
        const rechaza = i === 3 && horaLocal === 22;
        const momento = sql`
          ((current_date - ${d}::int)::text || ' ' || ${String(horaLocal).padStart(2, "0")} || ':' ||
            ${String(i * 10).padStart(2, "0")})::timestamp AT TIME ZONE ${ZONA}`;
        await db.insert(etiquetas).values({
          loteId: lote.id,
          caja: caja++,
          cantidad: 240,
          operarioId: quien.id,
          loteCodigo: lote.codigo,
          maquinaNombre: lote.maquinaNombre,
          frascoNombre: lote.frascoNombre,
          operarioNombre: quien.nombre,
          turno,
          creadoEn: momento as unknown as string,
          estadoCalidad: rechaza ? "rechazada" : "liberada",
          calidadPor: "Inspector Ruiz",
          calidadEn: momento as unknown as string,
        });
      }
    }
  }
  return true;
}

async function main() {
  requiereBaseDePrueba("test:metricas");
  await migrar();
  const armado = await asegurarFixture();

  const [{ n: cuantas }] = await crudo<{ n: number }>(
    sql`select count(*)::int as n from etiquetas`
  );
  if (cuantas === 0) {
    console.error("Sin datos. Corré: npm run db:seed");
    process.exit(1);
  }
  console.log(
    `\nBase: ${cuantas} etiquetas${armado ? " (fixture de 5 días armado por el test)" : ""}\n`
  );

  // -------------------------------------------------------------------------
  console.log("--- Totales ---");
  const t = await totales();
  const [c] = await crudo<{
    cajas: number;
    unidades: number;
    anuladas: number;
    operarios: number;
  }>(sql`
    select
      coalesce(sum(case when anulada = false then 1 else 0 end), 0)::int as cajas,
      coalesce(sum(case when anulada = false then cantidad else 0 end), 0)::int as unidades,
      coalesce(sum(case when anulada = true then 1 else 0 end), 0)::int as anuladas,
      count(distinct case when anulada = false then operario_nombre end)::int as operarios
    from etiquetas`);

  ok("cajas coincide con SQL crudo", t.cajas === c.cajas, `${t.cajas} vs ${c.cajas}`);
  ok("unidades coincide", t.unidades === c.unidades, `${t.unidades} vs ${c.unidades}`);
  ok("anuladas coincide", t.anuladas === c.anuladas, `${t.anuladas} vs ${c.anuladas}`);
  ok("operarios distintos", t.operarios === c.operarios, `${t.operarios} vs ${c.operarios}`);
  ok(
    "liberadas+pendientes+rechazadas = cajas",
    t.liberadas + t.pendientes + t.rechazadas === t.cajas,
    `${t.liberadas}+${t.pendientes}+${t.rechazadas} = ${t.cajas}`
  );
  ok("anuladas NO suman a cajas", t.cajas + t.anuladas === cuantas);
  // Con Postgres esto importa: count()/sum() vuelven como bigint y el driver
  // los da como string. Si el ::int faltara, esto seria una concatenacion.
  ok("los agregados son numeros, no strings", typeof t.cajas === "number", typeof t.cajas);

  // -------------------------------------------------------------------------
  console.log("\n--- Por operario ---");
  const porOp = await porDimension("operario");
  ok(
    "las partes suman el total",
    porOp.reduce((a, r) => a + r.cajas, 0) === t.cajas,
    `${porOp.reduce((a, r) => a + r.cajas, 0)} vs ${t.cajas}`
  );
  ok(
    "ordenado por unidades desc",
    porOp.every((r, i) => i === 0 || porOp[i - 1].unidades >= r.unidades)
  );

  for (const r of porOp) {
    const [x] = await crudo<{ cajas: number; unidades: number }>(sql`
      select count(*)::int as cajas, coalesce(sum(cantidad), 0)::int as unidades
      from etiquetas where operario_nombre = ${r.clave} and anulada = false`);
    ok(
      `  ${r.clave}`,
      r.cajas === x.cajas && r.unidades === x.unidades,
      `${r.cajas} cajas / ${r.unidades} u.`
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n--- Tasa de rechazo ---");
  for (const r of porOp) {
    if (r.tasaRechazo === null) continue;
    const esperada = Math.round((r.rechazadas / (r.liberadas + r.rechazadas)) * 1000) / 10;
    ok(`  ${r.clave}: ${r.tasaRechazo}%`, r.tasaRechazo === esperada);
  }

  // -------------------------------------------------------------------------
  console.log("\n--- Agrupado por día LOCAL, no UTC ---");
  const serie = await serieDiaria();
  const diasLocal = await crudo<{ dia: string; n: number }>(sql`
    select ((creado_en at time zone ${ZONA})::date)::text as dia, count(*)::int as n
    from etiquetas where anulada = false group by 1 order by 1`);

  ok("misma cantidad de días", serie.length === diasLocal.length, `${serie.length} vs ${diasLocal.length}`);
  ok(
    "serie ordenada cronológicamente",
    serie.every((r, i) => i === 0 || serie[i - 1].clave <= r.clave)
  );
  ok(
    "cada día coincide con el SQL crudo",
    serie.every((r, i) => r.clave === diasLocal[i].dia && r.cajas === diasLocal[i].n)
  );
  ok(
    "la clave del día es texto, no un objeto Date",
    typeof serie[0]?.clave === "string" && /^\d{4}-\d{2}-\d{2}$/.test(serie[0].clave),
    JSON.stringify(serie[0]?.clave)
  );

  // El chequeo que le da sentido a todo: que agrupar por UTC daría OTRO
  // resultado. Si diera lo mismo, el test no probaría nada.
  //
  // Ojo con esto: `(timestamptz)::date` a secas usa la zona de la SESION, no
  // UTC. Para comparar contra UTC de verdad hay que decirlo explicito. El
  // codigo de la app siempre usa AT TIME ZONE explicito, justamente para no
  // depender de una configuracion de sesion que no controlamos.
  const [{ n: desplazadas }] = await crudo<{ n: number }>(sql`
    select count(*)::int as n from etiquetas
    where anulada = false
      and (creado_en at time zone 'UTC')::date <> (creado_en at time zone ${ZONA})::date`);
  ok(
    "hay etiquetas que UTC pondría en otro día (el fix hace algo)",
    desplazadas > 0,
    `${desplazadas} etiquetas`
  );

  // -------------------------------------------------------------------------
  console.log("\n--- Filtros cruzados ---");
  const noche = await porDimension("operario", { turno: "Noche" });
  const [{ n: nNoche }] = await crudo<{ n: number }>(
    sql`select count(*)::int as n from etiquetas where turno = 'Noche' and anulada = false`
  );
  ok(
    "dim=operario + turno=Noche",
    noche.reduce((a, r) => a + r.cajas, 0) === nNoche,
    `${noche.reduce((a, r) => a + r.cajas, 0)} vs ${nNoche}`
  );

  const unDia = serie[Math.floor(serie.length / 2)].clave;
  const deEseDia = await totales({ desde: unDia, hasta: unDia });
  ok(
    `rango de un solo día (${unDia}) coincide con la serie`,
    deEseDia.cajas === serie.find((r) => r.clave === unDia)!.cajas,
    `${deEseDia.cajas} vs ${serie.find((r) => r.clave === unDia)!.cajas}`
  );

  for (const dim of ["maquina", "turno", "frasco"] as const) {
    const filas = await porDimension(dim);
    ok(
      `las partes de ${dim} suman el total`,
      filas.reduce((a, r) => a + r.cajas, 0) === t.cajas
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n--- Horas trabajadas: suma por día, no lapso total ---");
  for (const r of porOp) {
    if (r.dias === 0) continue;
    const lapsoBruto =
      r.primera && r.ultima ? (Date.parse(r.ultima) - Date.parse(r.primera)) / 3600000 : 0;
    const trabajadas = r.minutosActivos / 60;
    ok(
      `  ${r.clave}: ${trabajadas.toFixed(1)}h trabajadas vs ${lapsoBruto.toFixed(0)}h de lapso`,
      trabajadas <= lapsoBruto,
      lapsoBruto > 0 ? `el lapso bruto daría ${(r.cajas / lapsoBruto).toFixed(1)} cajas/h` : ""
    );

    const [x] = await crudo<{ t: number }>(sql`
      select coalesce(sum(m), 0)::float8 as t from (
        select extract(epoch from (max(creado_en) - min(creado_en))) / 60.0 as m
        from etiquetas
        where operario_nombre = ${r.clave} and anulada = false
        group by (creado_en at time zone ${ZONA})::date
      ) s`);
    ok(
      `  ${r.clave}: coincide con SQL crudo`,
      Math.round(Number(x.t)) === r.minutosActivos,
      `${Math.round(Number(x.t))} vs ${r.minutosActivos} min`
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n--- Muestra de lo que se ve en el tablero ---\n");
  console.log("  OPERARIO             CAJAS  UNIDADES  DÍAS  HS TRAB  CAJAS/H  %RECH");
  for (const r of porOp) {
    console.log(
      `  ${r.clave.padEnd(20)}${String(r.cajas).padStart(6)}${String(r.unidades).padStart(10)}` +
        `${String(r.dias).padStart(6)}${(r.minutosActivos / 60).toFixed(1).padStart(9)}` +
        `${String(r.cajasPorHora ?? "-").padStart(9)}${String(r.tasaRechazo ?? "-").padStart(7)}`
    );
  }

  console.log(fallas ? `\n${fallas} FALLAS\n` : "\nTodo OK\n");
  if (fallas) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => cerrarConexion());
