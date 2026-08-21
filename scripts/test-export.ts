/**
 * Verifica que el CSV exportado coincida EXACTAMENTE con lo que muestra la
 * pantalla para los mismos filtros.
 *
 *   npm run test:export     (necesita el server en :3100)
 *
 * Es el invariante que más importa de un export: si el Excel dice otra cosa que
 * la pantalla, el cliente pierde la confianza en todo el sistema.
 */
export {}; // marca el archivo como modulo: si no, TS lo mezcla con los otros scripts

const B = "http://127.0.0.1:3100";

let fallas = 0;
function ok(nombre: string, cond: boolean, extra = "") {
  console.log(`  ${cond ? "OK   " : "FALLA"} ${nombre}${extra ? "  -> " + extra : ""}`);
  if (!cond) fallas++;
}

/** Cuenta filas de datos del CSV, salteando `sep=;` y el encabezado. */
function filasCsv(texto: string): string[][] {
  const lineas = texto.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.length > 0);
  const sinSep = lineas[0]?.startsWith("sep=") ? lineas.slice(1) : lineas;
  return sinSep.slice(1).map((l) => l.split(";"));
}

async function json(ruta: string) {
  const r = await fetch(B + ruta);
  const j = (await r.json()) as { ok: boolean; data: any };
  return j.data;
}

async function csv(ruta: string) {
  const r = await fetch(B + ruta);
  // Ojo: r.text() descarta el BOM al decodificar (lo dice la spec de fetch).
  // Para verificar que el BOM realmente se envia hay que ver los bytes.
  const bytes = new Uint8Array(await r.arrayBuffer());
  const texto = new TextDecoder("utf-8").decode(bytes);
  return {
    texto,
    bytes,
    tipo: r.headers.get("content-type") ?? "",
    cd: r.headers.get("content-disposition") ?? "",
  };
}

const CASOS: { nombre: string; filtro: string }[] = [
  { nombre: "sin filtros", filtro: "" },
  { nombre: "un operario", filtro: "?operarioId=1" },
  { nombre: "solo liberadas", filtro: "?estado=liberada" },
  { nombre: "solo pendientes", filtro: "?estado=pendiente" },
  { nombre: "una maquina", filtro: "?maquina=Sopladora%201" },
  { nombre: "turno noche", filtro: "?turno=Noche" },
  { nombre: "operario + turno", filtro: "?operarioId=2&turno=Noche" },
  { nombre: "solo anuladas", filtro: "?soloAnuladas=1" },
];

async function main() {
  console.log("\n--- Cabeceras del CSV ---");
  const c0 = await csv("/api/export");
  ok("content-type es CSV", c0.tipo.includes("text/csv"), c0.tipo);
  ok("fuerza descarga con nombre", c0.cd.includes("attachment") && c0.cd.includes(".csv"), c0.cd);
  const bom = c0.bytes[0] === 0xef && c0.bytes[1] === 0xbb && c0.bytes[2] === 0xbf;
  ok(
    "arranca con BOM UTF-8 (Excel respeta acentos)",
    bom,
    `bytes: ${[...c0.bytes.slice(0, 3)].map((b) => b.toString(16)).join(" ")}`
  );
  ok("declara el separador para Excel en español", c0.texto.replace(/^﻿/, "").startsWith("sep=;"));

  console.log("\n--- El CSV coincide con la pantalla ---");
  for (const caso of CASOS) {
    const pantalla = await json(`/api/etiquetas${caso.filtro}${caso.filtro ? "&" : "?"}limit=1`);
    const archivo = await csv(`/api/export${caso.filtro}`);
    const filas = filasCsv(archivo.texto);
    ok(
      `${caso.nombre}: ${filas.length} filas en CSV = ${pantalla.total} en pantalla`,
      filas.length === pantalla.total
    );
  }

  console.log("\n--- Acentos en el archivo ---");
  const conAcento = await csv("/api/export?operarioId=2");
  const tieneAcentos = /[áéíóúñÁÉÍÓÚÑ]/.test(conAcento.texto);
  ok("el CSV conserva acentos", tieneAcentos);
  const enc = filasCsv(conAcento.texto);
  if (enc.length) {
    // Columna 8 (0-based) es Operario en el export detallado.
    console.log(`         ejemplo de operario en el CSV: "${enc[0][8]}"`);
  }

  console.log("\n--- Export agregado (eficiencia) ---");
  for (const dim of ["operario", "turno", "maquina", "dia"]) {
    const m = await json(`/api/metricas?dim=${dim}`);
    const a = await csv(`/api/export?dim=${dim}`);
    const filas = filasCsv(a.texto);
    ok(
      `dim=${dim}: ${filas.length} filas = ${m.filas.length} grupos`,
      filas.length === m.filas.length
    );
    ok(`dim=${dim}: nombre de archivo correcto`, a.cd.includes(`eficiencia_por_${dim}`));
  }

  console.log("\n--- Coherencia de números entre pantalla y CSV ---");
  const met = await json("/api/metricas?dim=operario");
  const agr = filasCsv((await csv("/api/export?dim=operario")).texto);
  for (const fila of met.filas) {
    const enCsv = agr.find((f) => f[0] === fila.clave);
    ok(
      `  ${fila.clave}: cajas y unidades iguales`,
      !!enCsv && Number(enCsv[1]) === fila.cajas && Number(enCsv[2]) === fila.unidades,
      enCsv ? `CSV ${enCsv[1]}/${enCsv[2]} vs API ${fila.cajas}/${fila.unidades}` : "no está en el CSV"
    );
  }

  console.log("\n--- Punto y coma dentro de un campo no rompe el CSV ---");
  const columnas = filasCsv(c0.texto).map((f) => f.length);
  const esperadas = 17; // el export detallado tiene 17 columnas
  ok(
    `todas las filas tienen ${esperadas} columnas`,
    columnas.every((n) => n === esperadas),
    `min ${Math.min(...columnas)} / max ${Math.max(...columnas)}`
  );

  console.log(fallas ? `\n${fallas} FALLAS\n` : "\nTodo OK\n");
  if (fallas) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
