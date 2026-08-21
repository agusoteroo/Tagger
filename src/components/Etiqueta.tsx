"use client";

import { fechaHora, type Etiqueta } from "@/lib/cliente";

/**
 * Vista previa de la etiqueta en pantalla. Es la maqueta que ve el operario,
 * no lo que se imprime.
 *
 * Cuando llegue la impresora (paso 3), la impresión real va a ser ZPL generado
 * en el servidor y enviado por TCP. Esta vista y `EtiquetaImprimible` de abajo
 * siguen sirviendo como respaldo si la impresora está caída.
 */
export function TicketEtiqueta({ e }: { e: Etiqueta }) {
  const { fecha, hora } = fechaHora(e.creadoEn);
  return (
    <div className="label-ticket">
      <div style={{ padding: "14px 16px 10px" }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <div
            className="font-display"
            style={{ fontWeight: 800, fontSize: 18, letterSpacing: ".04em" }}
          >
            ENPLAS
          </div>
          <div className="chip" style={{ background: "#14161A", color: "#F4F1EA" }}>
            {e.turno}
          </div>
        </div>

        <div className="font-display" style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
          {e.frascoNombre}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 10, opacity: 0.6, textTransform: "uppercase" }}>Lote</div>
            <div className="lote-huge" style={{ fontSize: 20 }}>
              {e.loteCodigo}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, opacity: 0.6, textTransform: "uppercase" }}>Caja</div>
            <div className="lote-huge" style={{ fontSize: 20 }}>
              #{e.caja}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            fontSize: 12,
            borderTop: "1px solid rgba(0,0,0,.15)",
            paddingTop: 8,
          }}
        >
          <div>
            <span style={{ opacity: 0.6 }}>Cantidad: </span>
            <b className="font-mono">{e.cantidad} u.</b>
          </div>
          <div>
            <span style={{ opacity: 0.6 }}>Fecha: </span>
            <span className="font-mono">
              {fecha} {hora}
            </span>
          </div>
        </div>

        <div style={{ fontSize: 12, marginTop: 4 }}>
          <span style={{ opacity: 0.6 }}>Operario: </span>
          <b>{e.operarioNombre}</b>
        </div>

        {/* Placeholder del código de barras. En el paso 3 lo genera la
            impresora directo desde el ZPL (^BCN), nítido y escaneable. */}
        <div style={{ marginTop: 10, borderTop: "1px dashed rgba(0,0,0,.2)", paddingTop: 8 }}>
          <div
            aria-hidden
            style={{
              height: 34,
              background:
                "repeating-linear-gradient(90deg, #14161A 0 2px, transparent 2px 4px, #14161A 4px 5px, transparent 5px 9px)",
              opacity: 0.85,
            }}
          />
          <div
            className="font-mono"
            style={{ fontSize: 11, textAlign: "center", marginTop: 3, letterSpacing: ".1em" }}
          >
            {e.loteCodigo}-{e.caja}
          </div>
        </div>
      </div>
      <div className="perf" />
    </div>
  );
}

/**
 * Versión para el diálogo de impresión del navegador (100x70mm).
 * Respaldo hasta que esté la impresora ZPL, y para reimprimir de urgencia.
 */
export function EtiquetaImprimible({ e }: { e: Etiqueta }) {
  const { fecha, hora } = fechaHora(e.creadoEn);
  return (
    <div
      style={{
        width: "94mm",
        height: "64mm",
        padding: "3mm",
        background: "#fff",
        color: "#000",
        fontFamily: "Inter, sans-serif",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: ".04em" }}>ENPLAS</span>
        <span
          style={{ fontSize: 11, border: "1px solid #000", borderRadius: 3, padding: "1px 5px" }}
        >
          {e.turno}
        </span>
      </div>

      <div style={{ fontSize: 15, fontWeight: 700, margin: "2mm 0" }}>{e.frascoNombre}</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2mm" }}>
        <div>
          <div style={{ fontSize: 9, textTransform: "uppercase" }}>Lote</div>
          <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 20, fontWeight: 700 }}>
            {e.loteCodigo}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 9, textTransform: "uppercase" }}>Caja</div>
          <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 20, fontWeight: 700 }}>
            #{e.caja}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
          marginTop: "2mm",
          borderTop: "1px solid #000",
          paddingTop: "1mm",
        }}
      >
        <div>
          <b>{e.cantidad}</b> u.
        </div>
        <div>
          {fecha} {hora}
        </div>
      </div>

      <div style={{ fontSize: 12, marginTop: "1mm" }}>
        Operario: <b>{e.operarioNombre}</b>
      </div>

      <div
        style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11, marginTop: "2mm", letterSpacing: ".08em" }}
      >
        {e.loteCodigo}-{e.caja}
      </div>
    </div>
  );
}

/** Contenedor que solo se ve al imprimir. Lo activa la regla @media print. */
export function ZonaImpresion({ e }: { e: Etiqueta | null }) {
  if (!e) return null;
  return (
    <div id="print-label" style={{ display: "none" }}>
      <EtiquetaImprimible e={e} />
    </div>
  );
}
