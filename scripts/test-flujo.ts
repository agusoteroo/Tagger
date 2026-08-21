/**
 * Flujo completo contra la API, con sesión real:
 * permisos por rol -> abrir lote -> etiquetar -> calidad -> anular.
 *
 *   npm run test:flujo     (necesita el server en :3100)
 */
import { cerrarConexion } from "../src/db";
import { setPin } from "../src/lib/auth";
import { requierePostgres } from "./_requiere-postgres";

const B = "http://127.0.0.1:3100";
let cookie = "";

/**
 * PINs propios del test.
 *
 * Antes estaban hardcodeados los del seed (3690/2468/1357) y el test se rompia
 * en cuanto alguien los cambiaba -- por ejemplo con `npm run demo:preparar`,
 * que los rota al azar a proposito. Un test no puede depender de un secreto que
 * otra herramienta esta disenada para cambiar: se pone los suyos.
 */
const PIN = { jefe: "911911", calidad: "922922", admin: "933933" } as const;

/** Los del seed. Se restauran al terminar, pase lo que pase. */
const SEED = { jefe: "3690", calidad: "2468", admin: "1357" } as const;

async function api(ruta: string, init?: RequestInit) {
  const r = await fetch(B + ruta, {
    ...init,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...init?.headers },
  });
  for (const c of r.headers.getSetCookie?.() ?? []) {
    const par = c.split(";")[0];
    if (par.startsWith("enplas_sesion=")) cookie = par;
  }
  return { status: r.status, json: (await r.json()) as any };
}

function chequear(nombre: string, ok: boolean, extra = "") {
  console.log(`  ${ok ? "OK   " : "FALLA"} ${nombre}${extra ? "  -> " + extra : ""}`);
  if (!ok) process.exitCode = 1;
}

const login = (pin: string) =>
  api("/api/auth/pin", { method: "POST", body: JSON.stringify({ pin }) });

const nuevoLote = (maquinaId: number, limite: number, limiteUnidad = "cajas") =>
  api("/api/lotes", { method: "POST", body: JSON.stringify({ maquinaId, limite, limiteUnidad }) });

const etiquetar = (maquinaId = 1, cantidad = 240) =>
  api("/api/etiquetas", {
    method: "POST",
    body: JSON.stringify({ maquinaId, operarioId: 1, turno: "Mañana", cantidad }),
  });

async function loteAbiertoEn(maquinaId: number) {
  const r = await api("/api/lotes?estado=abierto");
  return (r.json.data as any[]).find((l) => l.maquinaId === maquinaId);
}

async function main() {
  requierePostgres("test:flujo");

  // Preparación. Este test no puede depender de lo que dejó otro: fija sus
  // propios PINs y se asegura su propio lote abierto en la máquina 1.
  for (const [rol, pin] of Object.entries(PIN) as ["jefe" | "calidad" | "admin", string][]) {
    await setPin(rol, pin);
  }

  const entrada = await login(PIN.admin);
  if (entrada.status !== 200) throw new Error(`No pude entrar como admin: ${entrada.json.error}`);
  if (!(await loteAbiertoEn(1))) {
    const p = await nuevoLote(1, 500);
    if (p.status !== 200) throw new Error(`No pude preparar el lote inicial: ${p.json.error}`);
  }
  await api("/api/auth/salir", { method: "POST" });
  cookie = "";

  // =========================================================================
  console.log("\n--- Sin sesión: la pantalla de etiquetar es libre, el resto no ---");
  let r = await nuevoLote(1, 10);
  chequear("abrir lote sin PIN -> 403", r.status === 403, r.json.error);

  r = await api("/api/etiquetas/calidad", {
    method: "POST",
    body: JSON.stringify({ etiquetaIds: [1], estado: "liberada", por: "X" }),
  });
  chequear("liberar sin PIN -> 403", r.status === 403, r.json.error);

  r = await etiquetar();
  chequear("etiquetar SIN PIN funciona (el operario no se loguea)", r.status === 200, `caja=${r.json.data?.caja}`);

  // =========================================================================
  console.log("\n--- Calidad: dictamina, pero NO abre lotes ---");
  r = await login(PIN.calidad);
  chequear("login calidad", r.status === 200 && r.json.data.rol === "calidad", r.json.data?.rol);

  r = await nuevoLote(1, 10);
  chequear("calidad NO puede abrir lote -> 403", r.status === 403, r.json.error);

  // =========================================================================
  console.log("\n--- Jefe de planta: abre lotes, pero NO dictamina ni configura ---");
  r = await login(PIN.jefe);
  chequear("login jefe", r.status === 200 && r.json.data.rol === "jefe", r.json.data?.rol);

  r = await api("/api/etiquetas/calidad", {
    method: "POST",
    body: JSON.stringify({ etiquetaIds: [1], estado: "liberada", por: "X" }),
  });
  chequear("jefe NO puede liberar -> 403", r.status === 403, r.json.error);

  r = await api("/api/catalogos/operarios", {
    method: "POST",
    body: JSON.stringify({ nombre: "Intruso" }),
  });
  chequear("jefe NO puede configurar -> 403", r.status === 403, r.json.error);

  r = await nuevoLote(1, 40);
  chequear("jefe SÍ puede abrir lote", r.status === 200, r.json.data?.lote?.codigo);
  chequear("queda en cola: ya había uno abierto", r.json.data?.arrancoYa === false);
  const enCola = r.json.data.lote;

  // =========================================================================
  console.log("\n--- La cola arranca al cerrar el anterior ---");
  const previo = await loteAbiertoEn(1);
  r = await api(`/api/lotes/${previo.id}`, {
    method: "PATCH",
    body: JSON.stringify({ accion: "cerrar" }),
  });
  chequear("cierre manual", r.status === 200, `${r.json.data?.cerrado} -> ${r.json.data?.siguiente}`);
  chequear("arrancó el de la cola", r.json.data?.siguiente === enCola.codigo);

  const lote = await loteAbiertoEn(1);
  const loteId = lote.id;
  chequear("es el que estaba en cola", lote.codigo === enCola.codigo, lote.codigo);

  // =========================================================================
  console.log("\n--- Etiquetar y numerar ---");
  const ids: number[] = [];
  for (let i = 0; i < 5; i++) ids.push((await etiquetar()).json.data.id);

  const lista = await api(`/api/etiquetas?loteId=${loteId}&incluirAnuladas=1`);
  const cajas = lista.json.data.filas.map((f: any) => f.caja).sort((a: number, b: number) => a - b);
  chequear("5 etiquetas numeradas 1..5 en el lote nuevo", JSON.stringify(cajas) === "[1,2,3,4,5]", `cajas=${cajas}`);

  // =========================================================================
  console.log("\n--- Validaciones ---");
  for (const [caso, cantidad, esperado] of [
    ["cantidad 0", 0, 400],
    ["cantidad negativa", -5, 400],
  ] as const) {
    r = await etiquetar(1, cantidad);
    chequear(`${caso} rechazada`, r.status === esperado, r.json.error);
  }
  r = await etiquetar(9999);
  chequear("máquina inexistente -> 404", r.status === 404, r.json.error);

  // =========================================================================
  console.log("\n--- Calidad ---");
  await login(PIN.calidad);
  r = await api("/api/etiquetas/calidad", {
    method: "POST",
    body: JSON.stringify({ etiquetaIds: ids.slice(0, 3), estado: "liberada", por: "Inspector Ruiz" }),
  });
  chequear("liberar 3 etiquetas", r.status === 200 && r.json.data.afectadas.length === 3);

  r = await api("/api/etiquetas/calidad", {
    method: "POST",
    body: JSON.stringify({ etiquetaIds: [ids[3]], estado: "rechazada", por: "Inspector Ruiz", nota: "fuera de tolerancia" }),
  });
  chequear("rechazar una", r.status === 200);

  const post = await api(`/api/etiquetas?loteId=${loteId}&incluirAnuladas=1`);
  const filas = post.json.data.filas;
  chequear("3 liberadas", filas.filter((f: any) => f.estadoCalidad === "liberada").length === 3);
  chequear("1 rechazada", filas.filter((f: any) => f.estadoCalidad === "rechazada").length === 1);
  chequear(
    "guarda quién dictaminó y la nota",
    filas.find((f: any) => f.estadoCalidad === "rechazada")?.calidadNota === "fuera de tolerancia"
  );

  // =========================================================================
  console.log("\n--- Anular (no borra) ---");
  await login(PIN.admin);
  r = await api(`/api/etiquetas/${ids[4]}/anular`, {
    method: "POST",
    body: JSON.stringify({ por: "admin", motivo: "Caja dañada en el traslado" }),
  });
  chequear("anular etiqueta", r.status === 200 && r.json.data.anulada === true);

  // Dos invariantes distintos, y los dos importan:
  //  1. La fila sigue existiendo (anular no borra).
  //  2. Por defecto NO aparece, porque una caja anulada no es producción.
  const conAnuladas = await api(`/api/etiquetas?loteId=${loteId}&incluirAnuladas=1`);
  chequear(
    "la fila NO se borró (pidiendo anuladas)",
    conAnuladas.json.data.filas.length === 5,
    `filas=${conAnuladas.json.data.filas.length}`
  );
  const anul = conAnuladas.json.data.filas.find((f: any) => f.id === ids[4]);
  chequear("queda marcada como anulada", anul?.anulada === true);
  chequear("guarda el motivo", anul?.anuladaMotivo === "Caja dañada en el traslado", anul?.anuladaMotivo);

  const sinAnuladas = await api(`/api/etiquetas?loteId=${loteId}`);
  chequear(
    "por defecto NO cuenta como producción",
    sinAnuladas.json.data.filas.length === 4,
    `filas=${sinAnuladas.json.data.filas.length}`
  );

  r = await etiquetar();
  chequear("el número de caja anulado no se reusa", r.json.data.caja === 6, `caja=${r.json.data.caja}`);

  r = await api(`/api/etiquetas/${ids[4]}/anular`, {
    method: "POST",
    body: JSON.stringify({ por: "admin", motivo: "otra vez" }),
  });
  chequear("no se puede anular dos veces", r.status === 400, r.json.error);

  // =========================================================================
  console.log("\n--- Reimpresión auditada ---");
  await api(`/api/etiquetas/${ids[0]}/imprimir`, { method: "POST" });
  r = await api(`/api/etiquetas/${ids[0]}/imprimir`, { method: "POST" });
  chequear("cuenta 2 impresiones", r.json.data.impresiones === 2, `impresiones=${r.json.data.impresiones}`);

  // =========================================================================
  console.log("\n--- Cerrar sesión ---");
  await api("/api/auth/salir", { method: "POST" });
  cookie = "";
  r = await nuevoLote(1, 10);
  chequear("tras salir, vuelve a 403", r.status === 403);

  r = await etiquetar();
  chequear("pero etiquetar sigue funcionando", r.status === 200);

  console.log(process.exitCode ? "\nHUBO FALLAS\n" : "\nTodo OK\n");
}

/**
 * Los PINs del test se restauran SIEMPRE, incluso si el test falla a mitad de
 * camino. Si no, una corrida fallida deja la base con los PINs del test y el
 * próximo que abra la app no puede entrar.
 */
async function restaurarPins() {
  try {
    await setPin("jefe", SEED.jefe);
    await setPin("calidad", SEED.calidad);
    await setPin("admin", SEED.admin);
    console.log(`  (PINs restaurados: ${SEED.jefe} / ${SEED.calidad} / ${SEED.admin})`);
  } catch (e) {
    console.error("  OJO: no pude restaurar los PINs:", e);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await restaurarPins();
    await cerrarConexion();
  });
