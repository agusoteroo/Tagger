"use client";

import { useState } from "react";
import { Delete, Lock, Unlock } from "lucide-react";
import { api, type Rol } from "@/lib/cliente";

const TITULOS: Record<string, string> = {
  lotes: "Acceso a Lotes",
  calidad: "Acceso a Calidad",
  historial: "Acceso a Historial",
  metricas: "Acceso a Eficiencia",
  config: "Acceso a Configuración",
};

const SUBTITULOS: Record<string, string> = {
  lotes: "Ingresá el PIN de Jefe de planta o el de Administración.",
  calidad: "Ingresá el PIN de Calidad o el de Administración.",
  historial: "Ingresá cualquiera de los tres PINs.",
  metricas: "Ingresá cualquiera de los tres PINs.",
  config: "Esta sección requiere el PIN de Administración.",
};

export function PinModal({
  vista,
  onCancelar,
  onListo,
}: {
  vista: string;
  onCancelar: () => void;
  onListo: (rol: Rol) => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function verificar() {
    setEnviando(true);
    setError(null);
    try {
      // El PIN se valida EN EL SERVIDOR. Acá solo se manda.
      const r = await api.post<{ rol: Rol }>("/api/auth/pin", { pin });
      onListo(r.rol);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PIN incorrecto.");
      setPin("");
    } finally {
      setEnviando(false);
    }
  }

  function agregar(d: string) {
    setPin((p) => (p + d).slice(0, 8));
    setError(null);
  }

  return (
    <div
      onClick={onCancelar}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
      }}
    >
      <div className="card" style={{ width: 340, padding: 24 }} onClick={(ev) => ev.stopPropagation()}>
        <div className="row" style={{ marginBottom: 4 }}>
          <Lock size={18} style={{ color: "var(--amber)" }} />
          <div className="font-display" style={{ fontWeight: 700, fontSize: 20 }}>
            {TITULOS[vista] ?? "Acceso restringido"}
          </div>
        </div>
        <div className="small muted" style={{ marginBottom: 16 }}>
          {SUBTITULOS[vista] ?? ""}
        </div>

        <div
          className="card font-mono"
          style={{
            fontSize: 30,
            padding: 12,
            textAlign: "center",
            letterSpacing: ".4em",
            marginBottom: 8,
            background: "var(--panel-alt)",
            borderColor: error ? "var(--danger)" : "var(--border)",
            color: error ? "var(--danger)" : "var(--text)",
          }}
        >
          {pin ? (
            "•".repeat(pin.length)
          ) : (
            <span className="muted" style={{ letterSpacing: 0, fontSize: 16 }}>
              Ingresá el PIN
            </span>
          )}
        </div>

        <div
          className="tiny"
          style={{ minHeight: 18, marginBottom: 12, color: error ? "var(--danger)" : "transparent" }}
        >
          {error ?? " "}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 14 }}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button key={d} className="keypad-btn" onClick={() => agregar(d)}>
              {d}
            </button>
          ))}
          <button
            className="keypad-btn"
            onClick={() => {
              setPin("");
              setError(null);
            }}
          >
            C
          </button>
          <button className="keypad-btn" onClick={() => agregar("0")}>
            0
          </button>
          <button className="keypad-btn" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Borrar">
            <Delete size={20} />
          </button>
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost" style={{ padding: "11px 16px" }} onClick={onCancelar}>
            Cancelar
          </button>
          <button
            className="btn btn-amber grow"
            style={{ padding: 11 }}
            disabled={pin.length < 4 || enviando}
            onClick={verificar}
          >
            <Unlock size={16} /> {enviando ? "Verificando..." : "Ingresar"}
          </button>
        </div>
      </div>
    </div>
  );
}
