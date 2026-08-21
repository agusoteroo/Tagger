"use client";

import { AlertCircle, Check, RefreshCw, X } from "lucide-react";
import type { ReactNode } from "react";

export function EstadoVacio({
  icon,
  titulo,
  texto,
}: {
  icon: ReactNode;
  titulo: string;
  texto: string;
}) {
  return (
    <div
      className="card col"
      style={{ alignItems: "center", textAlign: "center", padding: "48px 32px", gap: 10 }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 999,
          background: "var(--amber-dim)",
          color: "var(--amber)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {icon}
      </div>
      <div className="font-display" style={{ fontWeight: 700, fontSize: 20 }}>
        {titulo}
      </div>
      <div className="muted small" style={{ maxWidth: 460, lineHeight: 1.5 }}>
        {texto}
      </div>
    </div>
  );
}

export function Cargando({ texto = "Cargando..." }: { texto?: string }) {
  return (
    <div className="row muted" style={{ justifyContent: "center", padding: 40, gap: 10 }}>
      <RefreshCw size={18} className="girando" />
      <span className="font-display" style={{ fontSize: 17 }}>
        {texto}
      </span>
    </div>
  );
}

/** Banda de error, con reintento opcional. */
export function Aviso({
  tipo = "error",
  children,
  onCerrar,
}: {
  tipo?: "error" | "ok" | "info";
  children: ReactNode;
  onCerrar?: () => void;
}) {
  const estilos = {
    error: { background: "var(--danger-dim)", color: "#ff9a9a", border: "1px solid #5a2323" },
    ok: { background: "var(--success-dim)", color: "var(--success)", border: "1px solid #24512f" },
    info: { background: "var(--steel-dim)", color: "var(--steel)", border: "1px solid #1f4552" },
  }[tipo];

  return (
    <div
      className="row small"
      style={{ ...estilos, borderRadius: 10, padding: "10px 14px", marginBottom: 14, gap: 10 }}
      role={tipo === "error" ? "alert" : "status"}
    >
      {tipo === "error" ? <AlertCircle size={15} /> : tipo === "ok" ? <Check size={15} /> : null}
      <span className="grow">{children}</span>
      {onCerrar && (
        <button
          onClick={onCerrar}
          aria-label="Cerrar aviso"
          style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0 }}
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}

export function ChipCalidad({
  estado,
  por,
  cuando,
  anulada,
}: {
  estado: string;
  por?: string | null;
  cuando?: string | null;
  anulada?: boolean;
}) {
  if (anulada) {
    return (
      <span className="chip" style={{ background: "#2a2a2a", color: "#999", border: "1px solid #3a3a3a" }}>
        Anulada
      </span>
    );
  }
  const titulo = por ? `${estado} por ${por}${cuando ? ` · ${cuando}` : ""}` : estado;
  if (estado === "liberada")
    return (
      <span className="chip chip-success" title={titulo}>
        <Check size={12} /> Liberada
      </span>
    );
  if (estado === "rechazada")
    return (
      <span className="chip chip-danger" title={titulo}>
        <X size={12} /> Rechazada
      </span>
    );
  return (
    <span className="chip chip-danger" title="Esperando dictamen de Calidad">
      <AlertCircle size={12} /> Pendiente
    </span>
  );
}

/** Tarjeta de métrica para la fila de arriba del tablero. */
export function Tarjeta({
  rotulo,
  valor,
  sub,
  color,
}: {
  rotulo: string;
  valor: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="card" style={{ padding: "14px 18px" }}>
      <div className="tiny muted" style={{ textTransform: "uppercase", letterSpacing: ".05em" }}>
        {rotulo}
      </div>
      <div
        className="font-mono"
        style={{ fontSize: 28, fontWeight: 700, color: color ?? "var(--text)", lineHeight: 1.25 }}
      >
        {valor}
      </div>
      {sub && <div className="tiny muted">{sub}</div>}
    </div>
  );
}

export function Modal({
  titulo,
  children,
  onCerrar,
  ancho = 420,
}: {
  titulo: string;
  children: ReactNode;
  onCerrar: () => void;
  ancho?: number;
}) {
  return (
    <div
      onClick={onCerrar}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        padding: 20,
      }}
    >
      <div
        className="card"
        style={{ width: ancho, maxWidth: "100%", maxHeight: "90vh", overflow: "auto", padding: 22 }}
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
          <div className="font-display" style={{ fontWeight: 700, fontSize: 20 }}>
            {titulo}
          </div>
          <button
            onClick={onCerrar}
            aria-label="Cerrar"
            style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
