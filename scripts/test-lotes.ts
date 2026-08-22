/**
 * Ciclo de vida del lote.
 *
 *   npm run test:lotes
 *
 * La regla la corrigió el cliente y cambia todo lo de acá abajo: **el lote no se
 * cierra por cantidad**. El objetivo es un plan, no un disparador. El lote se
 * cierra cuando en esa máquina arranca otro lote — que es lo que pasa cuando la
 * planta se pone a hacer otra cosa.
 *
 * Antes este archivo probaba lo contrario: cierre automático al llegar al
 * límite, y una cola de lotes "preparados" que arrancaban solos para que la
 * línea no se detuviera. Nada de eso existe más.
 */
import { eq, sql } from "drizzle-orm";
import { cerrarConexion, db } from "../src/db";
import { etiquetas, lotes, maquinas, operarios, frascos, turnos } from "../src/db/schema";
import { migrar } from "../src/db/migrar";
import { crearEtiqueta } from "../src/lib/etiquetas";
import { abrirLote, cerrarLoteManual, editarLimite } from "../src/lib/lotes";
import { requiereBaseDePrueba } from "./_requiere-postgres";

let fallas = 0;
function ok(nombre: string, cond: boolean, extra = "") {
  console.log(`  ${cond ? "OK   " : "FALLA"} ${nombre}${extra ? "  -> " + extra : ""}`);
  if (!cond) fallas++;
}

async function limpiar() {
  // Base virgen para que los números del test sean predecibles.
  await db.execute(sql`update maquinas set lote_actual_id = null`);
  await db.execute(sql`delete from etiquetas`);
  await db.execute(sql`delete from lotes`);
}

/**
 * El turno sale del CATALOGO, no hardcodeado.
 *
 * Tenia "Mañana" fijo, y eso contradecia lo que el propio test verifica mas
 * abajo: que el turno se valida contra el catalogo. Cuando otro test reescribio
 * los turnos (quedaron "A" y "B"), este fallo entero con un error que no tenia
 * nada que ver con los lotes.
 */
let TURNO = "";

function etiquetar(maquinaId: number, operarioId: number, cantidad: number) {
  return crearEtiqueta({ maquinaId, operarioId, turno: TURNO, cantidad });
}

async function estadoDe(id: number) {
  const [l] = await db.select().from(lotes).where(eq(lotes.id, id));
  return l!;
}

async function frascoDe(maquinaId: number) {
  const [m] = await db.select().from(maquinas).where(eq(maquinas.id, maquinaId));
  return m!.frascoId;
}

async function main() {
  requiereBaseDePrueba("test:lotes");
  await migrar();
  const [op] = await db.select().from(operarios).limit(1);
  /**
   * Solo maquinas ACTIVAS.
   *
   * Antes tomaba cualquiera, y el test fallaba con "la maquina esta inactiva"
   * -- un error que no tiene nada que ver con lo que prueba. Los tests comparten
   * base, y hay operaciones que dan de baja maquinas (la baja es logica:
   * activa = false, no un DELETE).
   */
  const maqs = await db.select().from(maquinas).where(eq(maquinas.activa, true));
  if (!op || maqs.length < 2) {
    throw new Error(
      `Hacen falta 2 maquinas activas y hay ${maqs.length}. Corré: npm run db:catalogos-demo`
    );
  }
  const [m1, m2] = maqs;

  const [turnoCat] = await db.select().from(turnos).where(eq(turnos.activo, true)).limit(1);
  if (!turnoCat) throw new Error("No hay turnos activos. Corré: npm run db:catalogos-demo");
  TURNO = turnoCat.nombre;
  console.log(`  (turno del catálogo: ${JSON.stringify(TURNO)})`);

  await limpiar();

  // =========================================================================
  console.log("\n--- Abrir un lote en una máquina parada ---");
  const a = await abrirLote({ maquinaId: m1.id, limite: 3, limiteUnidad: "cajas", actor: "test" });
  ok("queda abierto de una", (await estadoDe(a.lote.id)).estado === "abierto");
  ok("no cerró nada (no había lote antes)", a.cerrado === null);

  // =========================================================================
  // El corazón del cambio. Antes la caja 3 cerraba este lote.
  // =========================================================================
  console.log("\n--- El objetivo NO cierra el lote ---");
  const c1 = await etiquetar(m1.id, op.id, 100);
  ok("caja 1", c1.caja === 1 && !c1.lote.objetivoCumplido, `caja=${c1.caja}`);
  const c3 = await etiquetar(m1.id, op.id, 100);
  await etiquetar(m1.id, op.id, 100);
  ok("caja 3 llega al objetivo", (await estadoDe(a.lote.id)).estado === "abierto", "sigue ABIERTO");

  const c4 = await etiquetar(m1.id, op.id, 100);
  ok("la caja 4 se etiqueta igual", c4.caja === 4, `caja=${c4.caja}`);
  ok("el lote sigue abierto pasado el objetivo", (await estadoDe(a.lote.id)).estado === "abierto");
  ok("avisa que el objetivo está cumplido", c4.lote.objetivoCumplido);
  ok("y el porcentaje pasa de 100", c4.lote.porcentaje > 100, `${c4.lote.porcentaje}%`);
  ok("nunca se registró un cierre por límite", (await estadoDe(a.lote.id)).cerradoMotivo === null);
  void c3;

  // =========================================================================
  console.log("\n--- Cambiar de producto SÍ cierra el lote ---");
  const [fA] = await db.select().from(frascos).limit(1);
  const [fB] = await db.select().from(frascos).where(sql`${frascos.id} <> ${fA.id}`).limit(1);

  await limpiar();
  const medias = await abrirLote({
    maquinaId: m1.id,
    frascoId: fA.id,
    limite: 100,
    limiteUnidad: "cajas",
    actor: "jefe",
  });
  await etiquetar(m1.id, op.id, 50);
  await etiquetar(m1.id, op.id, 50);

  // Esto es el "cargo un lote de mandarinas en la máquina donde hago medias".
  const mandarinas = await abrirLote({
    maquinaId: m1.id,
    frascoId: fB.id,
    limite: 100,
    limiteUnidad: "cajas",
    actor: "jefe",
  });

  ok("el lote anterior quedó cerrado", (await estadoDe(medias.lote.id)).estado === "cerrado");
  ok(
    "con motivo 'cambio', no 'limite'",
    (await estadoDe(medias.lote.id)).cerradoMotivo === "cambio",
    (await estadoDe(medias.lote.id)).cerradoMotivo ?? "null"
  );
  ok(
    "informa cuál cerró y con cuánto llevaba",
    mandarinas.cerrado?.codigo === medias.lote.codigo && mandarinas.cerrado?.cajas === 2,
    `${mandarinas.cerrado?.codigo} con ${mandarinas.cerrado?.cajas} cajas (${mandarinas.cerrado?.porcentaje}%)`
  );
  ok(
    "se cerró LEJOS del objetivo y no protestó",
    (mandarinas.cerrado?.porcentaje ?? 999) < 10,
    `${mandarinas.cerrado?.porcentaje}% de 100 cajas`
  );
  ok("el nuevo está abierto", (await estadoDe(mandarinas.lote.id)).estado === "abierto");
  ok("y la máquina ahora produce el producto nuevo", (await frascoDe(m1.id)) === fB.id);

  const primeraDelNuevo = await etiquetar(m1.id, op.id, 10);
  ok("las cajas REINICIAN en 1", primeraDelNuevo.caja === 1, `caja=${primeraDelNuevo.caja}`);
  ok("y van al lote nuevo", primeraDelNuevo.loteCodigo === mandarinas.lote.codigo);

  // =========================================================================
  console.log("\n--- Un lote del MISMO producto también cierra el anterior ---");
  const mismo = await abrirLote({
    maquinaId: m1.id,
    frascoId: fB.id,
    limite: 50,
    limiteUnidad: "cajas",
    actor: "jefe",
  });
  ok("cerró el anterior igual", mismo.cerrado?.codigo === mandarinas.lote.codigo, mismo.cerrado?.codigo);
  ok("una máquina tiene UN lote abierto", (await estadoDe(mandarinas.lote.id)).estado === "cerrado");
  ok("números consecutivos del mismo producto", mismo.lote.numero === mandarinas.lote.numero + 1,
     `${mandarinas.lote.numero} -> ${mismo.lote.numero}`);

  // =========================================================================
  console.log("\n--- Cierre manual: la máquina queda parada ---");
  const r = await cerrarLoteManual({ loteId: mismo.lote.id, actor: "jefe" });
  ok("se cierra", r.cerrado === mismo.lote.codigo);
  ok("motivo 'manual'", (await estadoDe(mismo.lote.id)).cerradoMotivo === "manual");
  ok("la máquina queda sin lote", (await frascoDe(m1.id)) !== null && r.maquinaParada);

  let mensaje = "";
  try {
    await etiquetar(m1.id, op.id, 100);
  } catch (e) {
    mensaje = e instanceof Error ? e.message : String(e);
  }
  ok("sin lote no se puede etiquetar", mensaje.includes("jefe de planta"), mensaje.slice(0, 60));

  let err2 = "";
  try {
    await cerrarLoteManual({ loteId: mismo.lote.id, actor: "jefe" });
  } catch (e) {
    err2 = e instanceof Error ? e.message : "";
  }
  ok("no se puede cerrar dos veces", err2.length > 0, err2.slice(0, 50));

  // =========================================================================
  console.log("\n--- El objetivo en UNIDADES tampoco cierra ---");
  await limpiar();
  const u = await abrirLote({ maquinaId: m1.id, limite: 500, limiteUnidad: "unidades", actor: "t" });
  for (let i = 0; i < 3; i++) await etiquetar(m1.id, op.id, 240);
  ok("720 sobre 500: sigue abierto", (await estadoDe(u.lote.id)).estado === "abierto");
  const [totalFila] = await db
    .select({ n: sql<number>`coalesce(sum(${etiquetas.cantidad}),0)::int` })
    .from(etiquetas)
    .where(eq(etiquetas.loteId, u.lote.id));
  ok("el excedente queda registrado", totalFila!.n === 720, `${totalFila!.n} de 500 unidades`);

  // =========================================================================
  console.log("\n--- Bajar el objetivo por debajo de lo hecho no cierra nada ---");
  // Antes esto cerraba el lote en el acto. Es legítimo: el jefe se dio cuenta de
  // que había planificado de más.
  const ed = await editarLimite({ loteId: u.lote.id, limite: 100, limiteUnidad: "unidades", actor: "jefe" });
  ok("se ajusta", ed.ajustado);
  ok("el lote sigue abierto", (await estadoDe(u.lote.id)).estado === "abierto");
  ok("y el porcentaje refleja el exceso", ed.porcentaje === 720, `${ed.porcentaje}%`);

  // =========================================================================
  console.log("\n--- Numeración por PRODUCTO, no global ---");
  await limpiar();
  const p1 = await abrirLote({ maquinaId: m1.id, frascoId: fA.id, limite: 10, limiteUnidad: "cajas", actor: "t" });
  const p2 = await abrirLote({ maquinaId: m2.id, frascoId: fB.id, limite: 10, limiteUnidad: "cajas", actor: "t" });
  ok("cada producto tiene su propia secuencia", p1.lote.numero === p2.lote.numero,
     `${fA.nombre}=${p1.lote.numero}, ${fB.nombre}=${p2.lote.numero}`);
  ok("pero los códigos son distintos", p1.lote.codigo !== p2.lote.codigo,
     `${p1.lote.codigo} vs ${p2.lote.codigo}`);
  ok("y ninguno cerró al otro: son máquinas distintas",
     (await estadoDe(p1.lote.id)).estado === "abierto" &&
       (await estadoDe(p2.lote.id)).estado === "abierto");

  const p3 = await abrirLote({ maquinaId: m2.id, frascoId: fA.id, limite: 10, limiteUnidad: "cajas", actor: "t" });
  ok("mismo producto en otra máquina toma el número siguiente",
     p3.lote.numero === p1.lote.numero + 1, `${p1.lote.numero} -> ${p3.lote.numero}`);

  // =========================================================================
  console.log("\n--- Validaciones del formulario ---");
  const casos: [string, () => Promise<unknown>][] = [
    ["objetivo 0", () => abrirLote({ maquinaId: m1.id, limite: 0, limiteUnidad: "cajas", actor: "t" })],
    ["objetivo negativo", () => abrirLote({ maquinaId: m1.id, limite: -5, limiteUnidad: "cajas", actor: "t" })],
    ["máquina inexistente", () => abrirLote({ maquinaId: 9999, limite: 10, limiteUnidad: "cajas", actor: "t" })],
    ["producto inexistente", () => abrirLote({ maquinaId: m1.id, frascoId: 9999, limite: 10, limiteUnidad: "cajas", actor: "t" })],
  ];
  for (const [caso, fn] of casos) {
    let e = "";
    try {
      await fn();
    } catch (x) {
      e = x instanceof Error ? x.message : "";
    }
    ok(`rechaza ${caso}`, e.length > 0, e.slice(0, 52));
  }

  // Y que un rechazo NO haya cerrado el lote que estaba abierto: el cierre pasa
  // después de crear el nuevo justamente para esto.
  ok(
    "un alta rechazada no deja la máquina sin lote",
    (await estadoDe(p1.lote.id)).estado === "abierto",
    "el lote de m1 sigue abierto"
  );

  // =========================================================================
  console.log("\n--- Las anuladas no cuentan para el objetivo ---");
  await limpiar();
  const an = await abrirLote({ maquinaId: m1.id, limite: 2, limiteUnidad: "cajas", actor: "t" });
  const e1 = await etiquetar(m1.id, op.id, 100);
  await db.execute(sql`update etiquetas set anulada = true where id = ${e1.id}`);
  const e2 = await etiquetar(m1.id, op.id, 100);
  ok("con una anulada, 2 cajas dan 1 válida", !e2.lote.objetivoCumplido, `hecho=${e2.lote.hecho}`);
  const e3 = await etiquetar(m1.id, op.id, 100);
  ok("con 2 válidas se cumple el objetivo", e3.lote.objetivoCumplido, `hecho=${e3.lote.hecho}`);
  ok("los números de caja NO se reutilizan", e3.caja === 3, `caja=${e3.caja}`);
  ok("y el lote sigue abierto", (await estadoDe(an.lote.id)).estado === "abierto");

  // =========================================================================
  // El turno se valida contra el catálogo.
  //
  // Antes solo se chequeaba que no estuviera vacío, y entraba cualquier texto.
  // Una prueba mandó "Mañana" con la ñ mal codificada y quedó guardado
  // "Ma�ana": las métricas agrupan POR turno, así que eso aparecía como un
  // CUARTO turno para siempre y las horas de la planta dejaban de sumar.
  // =========================================================================
  console.log("\n--- Turno inválido: se rechaza, no se guarda ---");
  await limpiar();
  await abrirLote({ maquinaId: m1.id, limite: 500, limiteUnidad: "cajas", actor: "test" });

  const conTurno = (turno: string) =>
    crearEtiqueta({ maquinaId: m1.id, operarioId: op.id, turno, cantidad: 10 });

  for (const [caso, turno, esperado] of [
    // Estos NO salen del catálogo a propósito: son los valores que hay que
    // rechazar. El de la ñ es el caso real que apareció en producción.
    ["ñ mal codificada", "Ma�ana", "catálogo"],
    ["turno inexistente", "Madrugada del jueves", "catálogo"],
    ["distinta capitalización", TURNO.toLowerCase() + "_x", "catálogo"],
    ["vacío", "   ", "Falta el turno"],
  ] as const) {
    let m = "";
    try {
      await conTurno(turno);
    } catch (e) {
      m = (e as Error).message;
    }
    // No alcanza con que lance: tiene que lanzar POR EL TURNO. Un error de otra
    // cosa haría pasar el test sin haber ejercitado la validación.
    ok(`rechaza ${caso}`, m.includes(esperado), m ? m.slice(0, 55) : "LA GUARDÓ");
  }

  const conEspacios = await crearEtiqueta({
    maquinaId: m1.id,
    operarioId: op.id,
    turno: `  ${TURNO}  `,
    cantidad: 10,
  });
  ok("normaliza al nombre del catálogo", conEspacios.turno === TURNO,
     JSON.stringify(conEspacios.turno));

  const [fantasmas] = await db.select({ n: sql<number>`count(distinct turno)::int` }).from(etiquetas);
  ok("no quedó ningún turno fantasma", fantasmas!.n === 1, `turnos distintos=${fantasmas!.n}`);

  // Dejar la base usable. Si no, el test siguiente se encuentra las máquinas
  // paradas y falla por algo que no tiene nada que ver con lo que prueba.
  await limpiar();
  for (const m of maqs) {
    await abrirLote({ maquinaId: m.id, limite: 500, limiteUnidad: "cajas", actor: "test" });
  }
  console.log(`\n  (base dejada con un lote abierto por máquina)`);

  console.log(fallas ? `\n${fallas} FALLAS\n` : "\nTodo OK\n");
  if (fallas) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => cerrarConexion());
