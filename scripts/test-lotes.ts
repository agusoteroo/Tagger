/**
 * Prueba el ciclo de vida del lote: límite, cierre automático y cola.
 *
 *   npm run test:lotes
 *
 * Es la lógica nueva y la más delicada del sistema: si el cierre por límite
 * falla, o la cola no arranca, la línea de producción se detiene.
 */
import { eq, sql } from "drizzle-orm";
import { cerrarConexion, db } from "../src/db";
import { etiquetas, lotes, maquinas, operarios, frascos } from "../src/db/schema";
import { migrar } from "../src/db/migrar";
import { crearEtiqueta } from "../src/lib/etiquetas";
import { cancelarLotePreparado, cerrarLoteManual, prepararLote } from "../src/lib/lotes";
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

function etiquetar(maquinaId: number, operarioId: number, cantidad: number) {
  return crearEtiqueta({ maquinaId, operarioId, turno: "Mañana", cantidad });
}

async function estadoDe(id: number) {
  const [l] = await db.select().from(lotes).where(eq(lotes.id, id));
  return l!;
}

async function main() {
  requiereBaseDePrueba("test:lotes");
  await migrar();
  const [op] = await db.select().from(operarios).limit(1);
  const maqs = await db.select().from(maquinas);
  if (!op || maqs.length < 2) throw new Error("Corré primero: npm run db:seed");
  const [m1, m2] = maqs;

  await limpiar();

  // =========================================================================
  console.log("\n--- Límite en CAJAS: se cierra en la caja exacta ---");
  const a = await prepararLote({ maquinaId: m1.id, limite: 3, limiteUnidad: "cajas", actor: "test" });
  ok("arranca ya (la máquina no tenía lote)", a.arrancoYa);
  ok("estado abierto", (await estadoDe(a.lote.id)).estado === "abierto", (await estadoDe(a.lote.id)).estado);

  const c1 = await etiquetar(m1.id, op.id, 100);
  ok("caja 1", c1.caja === 1 && !c1.lote.cerrado, `caja=${c1.caja}`);
  const c2 = await etiquetar(m1.id, op.id, 100);
  ok("caja 2, sigue abierto", c2.caja === 2 && !c2.lote.cerrado);
  const c3 = await etiquetar(m1.id, op.id, 100);
  ok("caja 3 cierra el lote", c3.caja === 3 && c3.lote.cerrado === a.lote.codigo, `cerrado=${c3.lote.cerrado}`);
  ok("no había siguiente en cola", c3.lote.siguiente === null);
  ok("el lote quedó cerrado por límite", (await estadoDe(a.lote.id)).cerradoMotivo === "limite");

  // =========================================================================
  console.log("\n--- Sin lote no se puede etiquetar (la línea avisa, no adivina) ---");
  let mensaje = "";
  try {
    await etiquetar(m1.id, op.id, 100);
  } catch (e) {
    mensaje = e instanceof Error ? e.message : String(e);
  }
  ok("rechaza con mensaje claro", mensaje.includes("jefe de planta"), mensaje.slice(0, 70));

  // =========================================================================
  console.log("\n--- La cola arranca sola ---");
  await limpiar();
  const b1 = await prepararLote({ maquinaId: m1.id, limite: 2, limiteUnidad: "cajas", actor: "test" });
  const b2 = await prepararLote({ maquinaId: m1.id, limite: 5, limiteUnidad: "cajas", actor: "test" });
  ok("el segundo NO arranca, queda en cola", !b2.arrancoYa);
  ok("estado preparado", (await estadoDe(b2.lote.id)).estado === "preparado");
  ok("números consecutivos", b2.lote.numero === b1.lote.numero + 1, `${b1.lote.numero} -> ${b2.lote.numero}`);

  await etiquetar(m1.id, op.id, 100);
  const cierra = await etiquetar(m1.id, op.id, 100);
  ok("al llegar al límite arranca el siguiente", cierra.lote.siguiente === b2.lote.codigo,
     `siguiente=${cierra.lote.siguiente}`);
  ok("el primero quedó cerrado", (await estadoDe(b1.lote.id)).estado === "cerrado");
  ok("el segundo quedó abierto", (await estadoDe(b2.lote.id)).estado === "abierto");

  const nueva = await etiquetar(m1.id, op.id, 100);
  ok("la numeración de cajas REINICIA en 1", nueva.caja === 1, `caja=${nueva.caja}`);
  ok("la etiqueta quedó en el lote nuevo", nueva.loteCodigo === b2.lote.codigo, nueva.loteCodigo);

  // =========================================================================
  console.log("\n--- Límite en UNIDADES ---");
  await limpiar();
  const u = await prepararLote({ maquinaId: m1.id, limite: 500, limiteUnidad: "unidades", actor: "test" });
  await etiquetar(m1.id, op.id, 240);
  const u2 = await etiquetar(m1.id, op.id, 240);
  ok("480 de 500: sigue abierto", !u2.lote.cerrado, `hecho=${u2.lote.hecho}`);
  const u3 = await etiquetar(m1.id, op.id, 240);
  ok("720 pasa 500: cierra", u3.lote.cerrado === u.lote.codigo);
  ok("la caja que se pasó SE GUARDÓ igual", u3.caja === 3, `caja=${u3.caja}`);
  const [totalFila] = await db
    .select({ n: sql<number>`coalesce(sum(${etiquetas.cantidad}),0)::int` })
    .from(etiquetas)
    .where(eq(etiquetas.loteId, u.lote.id));
  const total = totalFila.n;
  ok("excedente registrado (720 sobre 500)", total === 720, `${total} unidades`);

  // =========================================================================
  console.log("\n--- Numeración por PRODUCTO, no global ---");
  await limpiar();
  const [fA] = await db.select().from(frascos).limit(1);
  const [fB] = await db.select().from(frascos).where(sql`${frascos.id} <> ${fA.id}`).limit(1);

  const p1 = await prepararLote({ maquinaId: m1.id, frascoId: fA.id, limite: 10, limiteUnidad: "cajas", actor: "t" });
  const p2 = await prepararLote({ maquinaId: m2.id, frascoId: fB.id, limite: 10, limiteUnidad: "cajas", actor: "t" });
  ok(
    `dos productos distintos arrancan los dos en su propio número`,
    p1.lote.numero === p2.lote.numero,
    `${fA.nombre}=${p1.lote.numero}, ${fB.nombre}=${p2.lote.numero}`
  );
  ok("pero los códigos son distintos", p1.lote.codigo !== p2.lote.codigo,
     `${p1.lote.codigo} vs ${p2.lote.codigo}`);

  // Mismo producto en otra máquina: toma el número siguiente, no colisiona.
  const p3 = await prepararLote({ maquinaId: m2.id, frascoId: fA.id, limite: 10, limiteUnidad: "cajas", actor: "t" });
  ok(
    "mismo producto en otra máquina toma el número siguiente",
    p3.lote.numero === p1.lote.numero + 1,
    `${p1.lote.numero} -> ${p3.lote.numero}`
  );

  // =========================================================================
  console.log("\n--- Cierre manual y cancelación ---");
  await limpiar();
  const m = await prepararLote({ maquinaId: m1.id, limite: 100, limiteUnidad: "cajas", actor: "test" });
  const enCola = await prepararLote({ maquinaId: m1.id, limite: 50, limiteUnidad: "cajas", actor: "test" });
  await etiquetar(m1.id, op.id, 100);

  const r = await cerrarLoteManual({ loteId: m.lote.id, actor: "jefe" });
  ok("cierre manual antes del límite", r.cerrado === m.lote.codigo);
  ok("y arranca el de la cola", r.siguiente === enCola.lote.codigo, `siguiente=${r.siguiente}`);
  ok("motivo registrado como manual", (await estadoDe(m.lote.id)).cerradoMotivo === "manual");

  const paraCancelar = await prepararLote({ maquinaId: m1.id, limite: 20, limiteUnidad: "cajas", actor: "t" });
  await cancelarLotePreparado({ loteId: paraCancelar.lote.id, actor: "jefe" });
  const canc = await estadoDe(paraCancelar.lote.id);
  ok("el cancelado NO se borra", !!canc, "la fila sigue existiendo");
  ok("queda con motivo 'cancelado'", canc.cerradoMotivo === "cancelado");

  let err2 = "";
  try {
    await cerrarLoteManual({ loteId: paraCancelar.lote.id, actor: "jefe" });
  } catch (e) {
    err2 = e instanceof Error ? e.message : "";
  }
  ok("no se puede cerrar un lote ya cerrado", err2.length > 0, err2.slice(0, 60));

  // El número cancelado NO se reusa.
  const despues = await prepararLote({ maquinaId: m1.id, limite: 20, limiteUnidad: "cajas", actor: "t" });
  ok(
    "el número de un lote cancelado no se reutiliza",
    despues.lote.numero > paraCancelar.lote.numero,
    `cancelado=${paraCancelar.lote.numero}, nuevo=${despues.lote.numero}`
  );

  // =========================================================================
  console.log("\n--- Validaciones del formulario ---");
  const casos: [string, () => Promise<unknown>][] = [
    ["límite 0", () => prepararLote({ maquinaId: m1.id, limite: 0, limiteUnidad: "cajas", actor: "t" })],
    ["límite negativo", () => prepararLote({ maquinaId: m1.id, limite: -5, limiteUnidad: "cajas", actor: "t" })],
    ["máquina inexistente", () => prepararLote({ maquinaId: 9999, limite: 10, limiteUnidad: "cajas", actor: "t" })],
  ];
  for (const [caso, fn] of casos) {
    let e = "";
    try {
      await fn();
    } catch (x) {
      e = x instanceof Error ? x.message : "";
    }
    ok(`rechaza ${caso}`, e.length > 0, e.slice(0, 55));
  }

  // =========================================================================
  console.log("\n--- Las anuladas no cuentan para el límite ---");
  await limpiar();
  const an = await prepararLote({ maquinaId: m1.id, limite: 2, limiteUnidad: "cajas", actor: "t" });
  const e1 = await etiquetar(m1.id, op.id, 100);
  // Anular la primera: el lote NO debería cerrarse en la segunda caja.
  await db.execute(sql`update etiquetas set anulada = true where id = ${e1.id}`);
  const e2 = await etiquetar(m1.id, op.id, 100);
  ok("con una anulada, la caja 2 no cierra el lote", !e2.lote.cerrado, `hecho=${e2.lote.hecho}`);
  const e3 = await etiquetar(m1.id, op.id, 100);
  ok("cierra en la caja 3 (2 válidas)", e3.lote.cerrado === an.lote.codigo);
  ok("los números de caja NO se reutilizan", e3.caja === 3, `caja=${e3.caja}`);

  // -------------------------------------------------------------------------
  // El turno se valida contra el catálogo.
  //
  // Antes solo se chequeaba que no estuviera vacío, y entraba cualquier texto.
  // Una prueba mandó "Mañana" con la ñ mal codificada y quedó guardado
  // "Ma�ana": las métricas agrupan POR turno, así que eso aparecía como un
  // CUARTO turno para siempre y las horas de la planta dejaban de sumar.
  // -------------------------------------------------------------------------
  console.log("\n--- Turno inválido: se rechaza, no se guarda ---");

  // La máquina necesita un lote ABIERTO para llegar a validar el turno. Sin
  // esto el test daba verde por el motivo equivocado: fallaba antes, en "no
  // tiene un lote abierto", y no probaba nada de lo que dice probar.
  await limpiar();
  await prepararLote({
    maquinaId: maqs[0]!.id,
    limite: 500,
    limiteUnidad: "cajas",
    actor: "test",
  });

  const conTurno = (turno: string) =>
    crearEtiqueta({ maquinaId: maqs[0]!.id, operarioId: op.id, turno, cantidad: 10 });

  for (const [caso, turno, esperado] of [
    ["ñ mal codificada", "Ma�ana", "catálogo"],
    ["turno inexistente", "Madrugada", "catálogo"],
    ["distinta capitalización", "mañana", "catálogo"],
    ["vacío", "   ", "Falta el turno"],
  ] as const) {
    let mensaje = "";
    try {
      await conTurno(turno);
    } catch (e) {
      mensaje = (e as Error).message;
    }
    // No alcanza con que lance: tiene que lanzar POR EL TURNO. Un error de otra
    // cosa haría pasar el test sin haber ejercitado la validación.
    ok(
      `rechaza ${caso}`,
      mensaje.includes(esperado),
      mensaje ? mensaje.slice(0, 58) : "LA GUARDÓ"
    );
  }

  // Y el valor que se guarda es el del catálogo, no el que vino en el pedido:
  // así ni una variante de espacios crea un grupo aparte.
  const conEspacios = await crearEtiqueta({
    maquinaId: maqs[0]!.id,
    operarioId: op.id,
    turno: "  Mañana  ",
    cantidad: 10,
  });
  ok(
    "normaliza al nombre del catálogo",
    conEspacios.turno === "Mañana",
    JSON.stringify(conEspacios.turno)
  );

  const [fantasmas] = await db
    .select({ n: sql<number>`count(distinct turno)::int` })
    .from(etiquetas);
  ok("no quedó ningún turno fantasma", fantasmas!.n === 1, `turnos distintos=${fantasmas!.n}`);

  // Dejar la base usable. Si no, el test siguiente se encuentra las máquinas
  // paradas y falla por algo que no tiene nada que ver con lo que prueba.
  await limpiar();
  for (const m of maqs) {
    await prepararLote({ maquinaId: m.id, limite: 500, limiteUnidad: "cajas", actor: "test" });
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
