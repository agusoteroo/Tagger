import { etiquetasParaExport } from "@/lib/etiquetas";
import { filtrosDeUrl } from "@/lib/filtros";
import { porDimension, esDimension } from "@/lib/metricas";
import { ZONA } from "@/lib/tiempo";

/**
 * GET /api/export?...           -> historial filtrado
 * GET /api/export?dim=operario  -> el resumen agregado de esa dimension
 *
 * Sale CSV, no XLSX. Es a proposito:
 *  - Excel lo abre igual (con la linea `sep=;` y el BOM de abajo, con acentos
 *    y separador correctos en Excel en español).
 *  - Cero dependencias en el servidor.
 *  - El export usa EXACTAMENTE los mismos filtros que la pantalla, asi que lo
 *    exportado siempre coincide con lo que se ve.
 */

// Excel en español espera punto y coma. Si el campo trae uno, va entre comillas.
function celda(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(filas: unknown[][]): string {
  // sep=; le dice a Excel el separador. BOM para que respete los acentos.
  return "﻿sep=;\n" + filas.map((f) => f.map(celda).join(";")).join("\r\n") + "\r\n";
}

/**
 * ISO UTC -> "20/08/2026" y "14:35" en hora local de la planta.
 *
 * Con la zona real, no con un offset fijo: no depende de la zona del servidor
 * (en Vercel es UTC) y respeta el horario de verano si algun dia vuelve.
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

function local(iso: string | null): { fecha: string; hora: string } {
  if (!iso) return { fecha: "", hora: "" };
  const partes = FORMATO.formatToParts(new Date(iso));
  const g = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return { fecha: `${g("day")}/${g("month")}/${g("year")}`, hora: `${g("hour")}:${g("minute")}` };
}

const ESTADO: Record<string, string> = {
  pendiente: "PENDIENTE",
  liberada: "LIBERADA",
  rechazada: "RECHAZADA",
};

function respuesta(contenido: string, nombre: string) {
  return new Response(contenido, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${nombre}"`,
      "cache-control": "no-store",
    },
  });
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const f = filtrosDeUrl(u);
  const hoy = new Date().toISOString().slice(0, 10);
  const dim = u.searchParams.get("dim");

  // --- Modo resumen agregado ------------------------------------------------
  if (esDimension(dim)) {
    const filas = await porDimension(dim, f);
    const titulo = dim === "dia" ? "Día" : dim[0].toUpperCase() + dim.slice(1);
    const salida = csv([
      [
        titulo,
        "Cajas",
        "Unidades",
        "Liberadas",
        "Pendientes",
        "Rechazadas",
        "Anuladas",
        "Minutos activos",
        "Cajas/hora",
        "% Rechazo",
        "Primera",
        "Última",
      ],
      ...filas.map((r) => {
        const p = local(r.primera);
        const ul = local(r.ultima);
        return [
          r.clave,
          r.cajas,
          r.unidades,
          r.liberadas,
          r.pendientes,
          r.rechazadas,
          r.anuladas,
          r.minutosActivos ?? "",
          // Coma decimal: Excel en español.
          r.cajasPorHora !== null ? String(r.cajasPorHora).replace(".", ",") : "",
          r.tasaRechazo !== null ? String(r.tasaRechazo).replace(".", ",") : "",
          `${p.fecha} ${p.hora}`.trim(),
          `${ul.fecha} ${ul.hora}`.trim(),
        ];
      }),
    ]);
    return respuesta(salida, `eficiencia_por_${dim}_${hoy}.csv`);
  }

  // --- Modo historial detallado --------------------------------------------
  const filas = await etiquetasParaExport(f);
  const salida = csv([
    [
      "Fecha",
      "Hora",
      "Máquina",
      "Frasco",
      "Lote",
      "Caja",
      "Cantidad",
      "Turno",
      "Operario",
      "Calidad",
      "Resuelto por",
      "Fecha calidad",
      "Nota calidad",
      "Anulada",
      "Anulada por",
      "Motivo anulación",
      "Impresiones",
    ],
    ...filas.map((r) => {
      const c = local(r.creadoEn);
      const q = local(r.calidadEn);
      return [
        c.fecha,
        c.hora,
        r.maquinaNombre,
        r.frascoNombre,
        r.loteCodigo,
        r.caja,
        r.cantidad,
        r.turno,
        r.operarioNombre,
        ESTADO[r.estadoCalidad] ?? r.estadoCalidad,
        r.calidadPor ?? "",
        `${q.fecha} ${q.hora}`.trim(),
        r.calidadNota ?? "",
        r.anulada ? "SÍ" : "",
        r.anuladaPor ?? "",
        r.anuladaMotivo ?? "",
        r.impresiones,
      ];
    }),
  ]);
  return respuesta(salida, `historial_etiquetado_${hoy}.csv`);
}

export const dynamic = "force-dynamic";
