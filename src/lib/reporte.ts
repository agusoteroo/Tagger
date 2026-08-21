import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { lotes, maquinas, operarios } from "@/db/schema";
import { type Filtros } from "./filtros";
import { porDimension, serieDiaria, totales, type FilaMetrica } from "./metricas";
import { finDelDia, inicioDelDia, ZONA } from "./tiempo";

/**
 * Genera un reporte HTML AUTOCONTENIDO.
 *
 * Un solo archivo, sin CSS ni fuentes ni scripts externos: se abre en cualquier
 * navegador, en la computadora o en el celular, y funciona sin internet.
 *
 * Por qué un archivo y no un link: la app corre en la planta. Un link
 * dependería de que esa máquina esté prendida y con el túnel arriba. El archivo
 * viaja solo — se manda por mail o WhatsApp y el cliente lo abre cuando quiera,
 * desde donde quiera.
 */

/** Escapa todo lo que venga de la base: nombres de operarios, notas, etc. */
function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const n = (x: number) => x.toLocaleString("es-AR");
const dec = (x: number | null, sufijo = "") =>
  x === null ? "—" : `${String(x).replace(".", ",")}${sufijo}`;

/**
 * ISO UTC -> fecha y hora local de la planta.
 *
 * Usa la zona real en vez de un offset fijo: Intl conoce la historia de cambios
 * de horario, asi que si Argentina vuelve al horario de verano esto sigue bien.
 * Y no depende de la zona del servidor, que en Vercel es UTC.
 */
const FORMATO = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function local(iso: string | null): string {
  if (!iso) return "—";
  const partes = FORMATO.formatToParts(new Date(iso));
  const g = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}`;
}

function diaCorto(clave: string) {
  const [, m, d] = clave.split("-");
  return d && m ? `${d}/${m}` : clave;
}

function fechaLegible(iso: string) {
  const [a, m, d] = iso.split("-");
  return d ? `${d}/${m}/${a}` : iso;
}

// ---------------------------------------------------------------------------
// Gráfico de barras en SVG. Sin librerías: tiene que funcionar offline.
// ---------------------------------------------------------------------------
function grafico(serie: FilaMetrica[]): string {
  if (serie.length < 2) return "";

  const ancho = 720;
  const alto = 190;
  const margenIzq = 44;
  const margenAbajo = 26;
  const util = ancho - margenIzq - 8;
  const utilAlto = alto - margenAbajo - 10;
  const max = Math.max(...serie.map((s) => s.cajas));
  const paso = util / serie.length;
  const anchoBarra = Math.max(2, Math.min(paso * 0.72, 40));

  // Etiquetas del eje X: si hay muchos días, se muestran salteadas.
  const cada = Math.ceil(serie.length / 12);

  const barras = serie
    .map((s, i) => {
      const h = max > 0 ? (s.cajas / max) * utilAlto : 0;
      const x = margenIzq + i * paso + (paso - anchoBarra) / 2;
      const y = 10 + utilAlto - h;
      const rot = i % cada === 0 || i === serie.length - 1;
      return (
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${anchoBarra.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" fill="#c8860d" rx="2"><title>${esc(diaCorto(s.clave))}: ${n(s.cajas)} cajas, ${n(s.unidades)} unidades</title></rect>` +
        (rot
          ? `<text x="${(x + anchoBarra / 2).toFixed(1)}" y="${alto - 8}" font-size="10" fill="#6b7280" text-anchor="middle">${esc(diaCorto(s.clave))}</text>`
          : "")
      );
    })
    .join("");

  // Eje Y con tres marcas.
  const marcas = [0, Math.round(max / 2), max]
    .map((v) => {
      const y = 10 + utilAlto - (max > 0 ? (v / max) * utilAlto : 0);
      return (
        `<line x1="${margenIzq}" y1="${y.toFixed(1)}" x2="${ancho - 8}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>` +
        `<text x="${margenIzq - 6}" y="${(y + 3).toFixed(1)}" font-size="10" fill="#6b7280" text-anchor="end">${n(v)}</text>`
      );
    })
    .join("");

  return `<div class="grafico"><svg viewBox="0 0 ${ancho} ${alto}" width="100%" role="img" aria-label="Cajas por día">${marcas}${barras}</svg></div>`;
}

// ---------------------------------------------------------------------------
function tabla(
  titulo: string,
  encabezado: string,
  filas: FilaMetrica[],
  opciones: { mostrarRitmo?: boolean } = {}
): string {
  if (!filas.length) return "";
  const ritmo = opciones.mostrarRitmo !== false;
  const maxU = Math.max(1, ...filas.map((f) => f.unidades));

  const cuerpo = filas
    .map((f) => {
      const alerta = f.tasaRechazo !== null && f.tasaRechazo >= 5;
      return `<tr>
      <td class="clave">${esc(encabezado === "Día" ? diaCorto(f.clave) : f.clave)}</td>
      <td class="num">${n(f.cajas)}</td>
      <td class="num">${n(f.unidades)}</td>
      <td class="barra-celda"><span class="barra"><i style="width:${((f.unidades / maxU) * 100).toFixed(1)}%"></i></span></td>
      ${ritmo ? `<td class="num">${f.dias}</td><td class="num">${(f.minutosActivos / 60).toFixed(1)}</td><td class="num destacado">${dec(f.cajasPorHora)}</td>` : ""}
      <td class="num ok">${n(f.liberadas)}</td>
      <td class="num">${n(f.pendientes)}</td>
      <td class="num${alerta ? " alerta" : ""}">${dec(f.tasaRechazo, "%")}</td>
    </tr>`;
    })
    .join("");

  return `<section>
    <h2>${esc(titulo)}</h2>
    <div class="scroll"><table>
      <thead><tr>
        <th>${esc(encabezado)}</th>
        <th class="num">Cajas</th>
        <th class="num">Unidades</th>
        <th>Participación</th>
        ${ritmo ? '<th class="num">Días</th><th class="num">Hs trab.</th><th class="num">Cajas/h</th>' : ""}
        <th class="num">Liberadas</th>
        <th class="num">Pend.</th>
        <th class="num">% Rech.</th>
      </tr></thead>
      <tbody>${cuerpo}</tbody>
    </table></div>
  </section>`;
}

// ---------------------------------------------------------------------------
/** Lotes cerrados en el período: es la parte de trazabilidad del reporte. */
async function tablaLotes(f: Filtros): Promise<string> {
  // El rango se filtra por fecha de CIERRE, no de apertura: un lote cerrado en
  // el periodo es lo que se termino de producir en ese periodo. Y se filtra en
  // SQL, no en JavaScript: antes se traian 60 lotes y se descartaban despues,
  // asi que con un rango angosto podia devolver menos de lo que habia.
  const cond = [eq(lotes.estado, "cerrado"), isNotNull(lotes.cerradoEn)];
  if (f.desde) cond.push(sql`${lotes.cerradoEn} >= ${inicioDelDia(f.desde)}`);
  if (f.hasta) cond.push(sql`${lotes.cerradoEn} < ${finDelDia(f.hasta)}`);

  const filas = await db
    .select()
    .from(lotes)
    .where(and(...cond))
    .orderBy(desc(lotes.cerradoEn))
    .limit(60);

  if (!filas.length) return "";

  const MOTIVO: Record<string, string> = {
    limite: "Completo",
    manual: "Cerrado a mano",
    cancelado: "Cancelado",
  };

  const cuerpo = filas
    .map(
      (l) => `<tr>
      <td class="clave mono">${esc(l.codigo)}</td>
      <td>${esc(l.maquinaNombre)}</td>
      <td class="tenue">${esc(l.frascoNombre)}</td>
      <td class="num">${n(l.limite)} ${l.limiteUnidad === "cajas" ? "cajas" : "u."}</td>
      <td class="tenue">${esc(local(l.cerradoEn))}</td>
      <td>${esc(MOTIVO[l.cerradoMotivo ?? ""] ?? "—")}</td>
      <td class="tenue">${esc(l.nota ?? "")}</td>
    </tr>`
    )
    .join("");

  return `<section>
    <h2>Lotes cerrados en el período</h2>
    <div class="scroll"><table>
      <thead><tr><th>Lote</th><th>Máquina</th><th>Producto</th><th class="num">Límite</th><th>Cerrado</th><th>Motivo</th><th>Nota</th></tr></thead>
      <tbody>${cuerpo}</tbody>
    </table></div>
  </section>`;
}

// ---------------------------------------------------------------------------
export async function generarReporte(f: Filtros): Promise<{ html: string; nombreArchivo: string }> {
  const [t, serie] = await Promise.all([totales(f), serieDiaria(f)]);
  const generado = local(new Date().toISOString());

  const periodo =
    f.desde && f.hasta
      ? f.desde === f.hasta
        ? fechaLegible(f.desde)
        : `${fechaLegible(f.desde)} al ${fechaLegible(f.hasta)}`
      : f.desde
        ? `desde el ${fechaLegible(f.desde)}`
        : f.hasta
          ? `hasta el ${fechaLegible(f.hasta)}`
          : "todo el historial";

  // Los filtros van SIEMPRE visibles en el encabezado. Un reporte que cubre
  // solo a un operario o una maquina y no lo aclara es enganoso: el que lo
  // recibe va a leer los totales como si fueran de toda la planta.
  //
  // La pantalla manda operarioId (numero), no el nombre, asi que hay que
  // resolverlo. Antes esto se perdia en silencio.
  const filtrosPuestos: string[] = [];

  if (f.operario) {
    filtrosPuestos.push(`Operario: ${f.operario}`);
  } else if (f.operarioId) {
    const [op] = await db.select().from(operarios).where(eq(operarios.id, f.operarioId));
    filtrosPuestos.push(`Operario: ${op?.nombre ?? `#${f.operarioId}`}`);
  }

  if (f.maquina) {
    filtrosPuestos.push(`Máquina: ${f.maquina}`);
  } else if (f.maquinaId) {
    const [mq] = await db.select().from(maquinas).where(eq(maquinas.id, f.maquinaId));
    filtrosPuestos.push(`Máquina: ${mq?.nombre ?? `#${f.maquinaId}`}`);
  }

  if (f.turno) filtrosPuestos.push(`Turno: ${f.turno}`);
  if (f.frasco) filtrosPuestos.push(`Producto: ${f.frasco}`);
  if (f.estado) filtrosPuestos.push(`Estado de calidad: ${f.estado}`);
  if (f.q?.trim()) filtrosPuestos.push(`Búsqueda: "${f.q.trim()}"`);

  const dictaminadas = t.liberadas + t.rechazadas;
  const tasaGlobal = dictaminadas > 0 ? Math.round((t.rechazadas / dictaminadas) * 1000) / 10 : null;

  const tarjeta = (rotulo: string, valor: string, sub = "", clase = "") =>
    `<div class="tarjeta ${clase}"><div class="rotulo">${esc(rotulo)}</div><div class="valor">${valor}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}</div>`;

  // Las cuatro dimensiones y los lotes se piden en paralelo: son consultas
  // independientes y contra una base remota la latencia se suma.
  const [porOperario, porTurno, porMaquina, porFrasco, htmlLotes] = await Promise.all([
    porDimension("operario", f),
    porDimension("turno", f),
    porDimension("maquina", f),
    porDimension("frasco", f),
    tablaLotes(f),
  ]);
  const tablas = {
    operario: tabla("Producción por operario", "Operario", porOperario),
    turno: tabla("Producción por turno", "Turno", porTurno),
    maquina: tabla("Producción por máquina", "Máquina", porMaquina),
    frasco: tabla("Producción por producto", "Producto", porFrasco, { mostrarRitmo: false }),
    lotes: htmlLotes,
  };

  const cuerpo =
    t.cajas === 0
      ? `<section><p class="vacio">No hay producción registrada en este período.</p></section>`
      : `
    <section class="tarjetas">
      ${tarjeta("Cajas producidas", n(t.cajas), `${t.dias} ${t.dias === 1 ? "día" : "días"} con producción`, "principal")}
      ${tarjeta("Unidades", n(t.unidades))}
      ${tarjeta("Liberadas por Calidad", n(t.liberadas), t.cajas ? `${Math.round((t.liberadas / t.cajas) * 100)}% del total` : "", "ok")}
      ${tarjeta("Pendientes de dictamen", n(t.pendientes), "", t.pendientes ? "alerta" : "")}
      ${tarjeta("Rechazadas", n(t.rechazadas), tasaGlobal !== null ? `${dec(tasaGlobal, "%")} de rechazo` : "", t.rechazadas ? "alerta" : "")}
      ${tarjeta("Anuladas", n(t.anuladas), "no cuentan como producción")}
    </section>

    ${serie.length > 1 ? `<section><h2>Cajas por día</h2>${grafico(serie)}</section>` : ""}

    ${tablas.operario}
    ${tablas.turno}
    ${tablas.maquina}
    ${tablas.frasco}
    ${tablas.lotes}

    <section class="nota">
      <h3>Cómo leer estos números</h3>
      <p><strong>% Rechazo</strong> se calcula sobre las cajas que Calidad ya dictaminó
      (liberadas + rechazadas), no sobre el total. Si se calculara sobre el total, un lote
      recién producido con todo pendiente mostraría 0% y parecería perfecto.</p>
      <p><strong>Hs trab.</strong> es la suma, día por día, del lapso entre la primera y la
      última caja de ese grupo. No es el rango completo del reporte: eso incluiría noches y
      fines de semana y daría un ritmo falso. Sigue siendo una aproximación — no ve el tiempo
      antes de la primera caja ni después de la última, y sí cuenta las pausas del medio.</p>
      <p><strong>Cajas/h</strong> es cajas divididas por esas horas trabajadas. Sirve para
      comparar entre operarios en condiciones parecidas, no como medida absoluta de
      productividad.</p>
      <p><strong>Las cajas anuladas</strong> no suman a la producción, pero su número de caja
      no se reutiliza: el hueco en la secuencia es la evidencia de que ahí hubo una caja.</p>
    </section>`;

  const html = `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ENPLAS · Reporte de producción — ${esc(periodo)}</title>
<style>
  /* Todo inline y con fuentes del sistema: el archivo tiene que abrirse sin internet. */
  :root { --tinta:#111827; --tenue:#6b7280; --linea:#e5e7eb; --ambar:#b45309; --ok:#15803d; --mal:#b91c1c; }
  * { box-sizing:border-box; }
  body { margin:0; background:#f9fafb; color:var(--tinta);
    font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .hoja { max-width:900px; margin:0 auto; padding:32px 24px 64px; }
  header { border-bottom:2px solid var(--tinta); padding-bottom:16px; margin-bottom:24px; }
  .marca { font-size:13px; letter-spacing:.12em; text-transform:uppercase; color:var(--tenue); }
  h1 { font-size:26px; margin:6px 0 4px; }
  .periodo { font-size:17px; color:var(--tinta); }
  .meta { font-size:13px; color:var(--tenue); margin-top:8px; }
  .filtros { background:#fef3c7; border:1px solid #fcd34d; color:#92400e;
    border-radius:8px; padding:9px 12px; font-size:13px; margin-top:10px; line-height:1.45; }
  .alcance { font-size:12px; color:var(--tenue); margin-top:8px; }
  h2 { font-size:17px; margin:32px 0 10px; padding-bottom:6px; border-bottom:1px solid var(--linea); }
  h3 { font-size:15px; margin:0 0 8px; }
  section { margin-bottom:4px; }
  .tarjetas { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin:20px 0 8px; }
  .tarjeta { background:#fff; border:1px solid var(--linea); border-radius:10px; padding:12px 14px; }
  .tarjeta .rotulo { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--tenue); }
  .tarjeta .valor { font-size:26px; font-weight:700; line-height:1.2;
    font-variant-numeric:tabular-nums; }
  .tarjeta .sub { font-size:11px; color:var(--tenue); }
  .tarjeta.principal .valor { color:var(--ambar); }
  .tarjeta.ok .valor { color:var(--ok); }
  .tarjeta.alerta .valor { color:var(--mal); }
  .grafico { background:#fff; border:1px solid var(--linea); border-radius:10px; padding:12px; }
  .scroll { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; background:#fff; font-size:13px;
    border:1px solid var(--linea); border-radius:10px; overflow:hidden; }
  th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.04em;
    color:var(--tenue); font-weight:600; padding:9px 10px; background:#f3f4f6;
    border-bottom:1px solid var(--linea); white-space:nowrap; }
  td { padding:8px 10px; border-bottom:1px solid var(--linea); }
  tr:last-child td { border-bottom:none; }
  .num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .mono { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
  .clave { font-weight:600; }
  .tenue { color:var(--tenue); }
  .ok { color:var(--ok); }
  .alerta { color:var(--mal); font-weight:700; }
  .destacado { color:var(--ambar); font-weight:700; }
  .barra-celda { width:110px; }
  .barra { display:block; height:7px; background:#f3f4f6; border-radius:999px; overflow:hidden; }
  .barra i { display:block; height:100%; background:#c8860d; border-radius:999px; }
  .vacio { background:#fff; border:1px solid var(--linea); border-radius:10px;
    padding:32px; text-align:center; color:var(--tenue); }
  .nota { margin-top:36px; background:#fff; border:1px solid var(--linea);
    border-left:3px solid var(--ambar); border-radius:8px; padding:16px 18px;
    font-size:13px; color:#374151; }
  .nota p { margin:0 0 10px; }
  .nota p:last-child { margin-bottom:0; }
  footer { margin-top:32px; padding-top:14px; border-top:1px solid var(--linea);
    font-size:12px; color:var(--tenue); }
  @media print {
    body { background:#fff; }
    .hoja { padding:0; max-width:none; }
    section { break-inside:avoid; }
    @page { margin:14mm; }
  }
</style>
</head>
<body>
<div class="hoja">
  <header>
    <div class="marca">ENPLAS · Trazabilidad de cajas</div>
    <h1>Reporte de producción</h1>
    <div class="periodo">${esc(periodo)}</div>
    ${
      filtrosPuestos.length
        ? `<div class="filtros"><strong>Reporte parcial.</strong> Estos números NO son de toda la planta: están filtrados por ${filtrosPuestos.map((x) => `<b>${esc(x)}</b>`).join(" · ")}</div>`
        : `<div class="alcance">Incluye toda la planta: todas las máquinas, operarios y turnos.</div>`
    }
    <div class="meta">Generado el ${esc(generado)}</div>
  </header>
  ${cuerpo}
  <footer>
    Este archivo es una <strong>foto del momento en que se generó</strong>
    (${esc(generado)}). No se actualiza solo: si necesitás los números al día,
    pedí un reporte nuevo.
  </footer>
</div>
</body>
</html>`;

  const hoy = new Date().toISOString().slice(0, 10);
  return { html, nombreArchivo: `reporte-etiquetado-${hoy}.html` };
}
