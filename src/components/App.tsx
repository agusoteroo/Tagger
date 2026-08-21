"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart3,
  FlaskConical,
  History,
  Layers,
  Lock,
  Package,
  Printer,
  Settings,
  ShieldCheck,
  Unlock,
} from "lucide-react";
import { api, ETIQUETA_ROL, type Catalogos, type Permiso, type Rol } from "@/lib/cliente";
import { Aviso, Cargando } from "./ui";
import { EtiquetarView } from "./EtiquetarView";
import { LotesView } from "./LotesView";
import { CalidadView } from "./CalidadView";
import { HistorialView } from "./HistorialView";
import { MetricasView } from "./MetricasView";
import { ConfigView } from "./ConfigView";
import { PinModal } from "./PinModal";

type Vista = "etiquetar" | "lotes" | "calidad" | "historial" | "metricas" | "config";

/**
 * Permiso que hace falta para cada vista.
 *
 * Ya no es una escalera: el jefe de planta abre lotes pero no dictamina
 * calidad, y Calidad dictamina pero no abre lotes. Ninguno es "más" que el
 * otro, así que cada vista pide un permiso concreto.
 */
const NECESITA: Record<Vista, Permiso> = {
  etiquetar: "etiquetar",
  lotes: "lotes",
  calidad: "calidad",
  historial: "ver",
  metricas: "ver",
  config: "config",
};

/** Minutos sin actividad tras los que la pantalla se bloquea sola. */
const AUTO_BLOQUEO_MS = 5 * 60 * 1000;

export function App() {
  const [vista, setVista] = useState<Vista>("etiquetar");
  const [cat, setCat] = useState<Catalogos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pidiendoPin, setPidiendoPin] = useState<Vista | null>(null);
  const ultimaActividad = useRef(Date.now());

  const rol: Rol = cat?.rol ?? "operario";
  // Los permisos los define el servidor, no el navegador. Acá solo se usan
  // para no mostrar botones que van a dar 403.
  const permisos = cat?.permisos ?? ["etiquetar"];
  const alcanza = (v: Vista) => permisos.includes(NECESITA[v]);

  const recargar = useCallback(async () => {
    try {
      setCat(await api.get<Catalogos>("/api/catalogos"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo conectar con el servidor.");
    }
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  function pedirAcceso(v: Vista) {
    if (alcanza(v)) setVista(v);
    else setPidiendoPin(v);
  }

  const bloquear = useCallback(async () => {
    try {
      await api.post("/api/auth/salir");
    } catch {
      /* igual volvemos a etiquetar */
    }
    setVista("etiquetar");
    await recargar();
  }, [recargar]);

  // Auto-bloqueo: la pantalla queda libre en planta, no puede quedar abierta
  // con permisos de admin si alguien se va.
  useEffect(() => {
    if (rol === "operario") return;
    const marcar = () => (ultimaActividad.current = Date.now());
    const eventos = ["mousedown", "keydown", "touchstart"] as const;
    for (const ev of eventos) window.addEventListener(ev, marcar);
    const t = setInterval(() => {
      if (Date.now() - ultimaActividad.current > AUTO_BLOQUEO_MS) void bloquear();
    }, 15_000);
    return () => {
      for (const ev of eventos) window.removeEventListener(ev, marcar);
      clearInterval(t);
    };
  }, [rol, bloquear]);

  // Si el rol se cae (sesión vencida), volver a una vista permitida.
  useEffect(() => {
    if (cat && !alcanza(vista)) setVista("etiquetar");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat, vista]);

  if (!cat) {
    return (
      <main style={{ padding: 32, maxWidth: 600, margin: "0 auto" }}>
        {error ? <Aviso>{error}</Aviso> : <Cargando texto="Cargando planta..." />}
        {error && (
          <button className="btn btn-amber" onClick={() => void recargar()}>
            Reintentar
          </button>
        )}
      </main>
    );
  }

  const tabs: { id: Vista; rotulo: string; icono: React.ReactNode; badge?: number; alerta?: boolean }[] = [
    { id: "etiquetar", rotulo: "Etiquetar", icono: <Printer size={16} /> },
    {
      id: "lotes",
      rotulo: "Lotes",
      icono: <Layers size={16} />,
      // Máquina parada por falta de lote: es lo más urgente de la planta.
      badge: cat.sinLote || undefined,
      alerta: cat.sinLote > 0,
    },
    { id: "calidad", rotulo: "Calidad", icono: <ShieldCheck size={16} />, badge: cat.pendientesCalidad || undefined },
    { id: "metricas", rotulo: "Eficiencia", icono: <BarChart3 size={16} /> },
    { id: "historial", rotulo: "Historial", icono: <History size={16} /> },
    { id: "config", rotulo: "Configuración", icono: <Settings size={16} /> },
  ];

  return (
    <>
      {cat.modoDemo && (
        <div className="banner-demo no-print">
          <FlaskConical size={15} />
          <span>
            <b>AMBIENTE DE PRUEBA</b> — los datos son de ejemplo y se van a borrar. No lo uses para
            etiquetar cajas reales.
          </span>
        </div>
      )}
      <div style={{ maxWidth: 1500, margin: "0 auto", padding: "0 16px 40px" }}>
      <header
        className="row wrap no-print"
        style={{
          justifyContent: "space-between",
          padding: "18px 0",
          borderBottom: "1px solid var(--border)",
          gap: 14,
        }}
      >
        <div className="row" style={{ gap: 12 }}>
          <div
            className="row"
            style={{
              width: 36,
              height: 36,
              borderRadius: 9,
              background: "var(--amber-dim)",
              color: "var(--amber)",
              justifyContent: "center",
            }}
          >
            <Package size={20} />
          </div>
          <div>
            <div
              className="font-display"
              style={{ fontWeight: 700, fontSize: 21, lineHeight: 1, letterSpacing: ".03em" }}
            >
              ENPLAS · ETIQUETADO
            </div>
            <div className="tiny muted">Trazabilidad de cajas en planta</div>
          </div>
        </div>

        <nav className="row wrap" style={{ gap: 4 }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`tab-btn ${vista === t.id ? "active" : ""}`}
              onClick={() => pedirAcceso(t.id)}
            >
              {alcanza(t.id) ? t.icono : <Lock size={14} />} {t.rotulo}
              {t.badge ? (
                <span
                  className="font-mono"
                  style={{
                    background: t.alerta ? "var(--danger)" : "var(--amber)",
                    color: t.alerta ? "#1a0000" : "#1a1200",
                    borderRadius: 999,
                    fontSize: 11,
                    padding: "1px 7px",
                    fontWeight: 700,
                  }}
                >
                  {t.badge}
                </span>
              ) : null}
            </button>
          ))}

          {rol !== "operario" && (
            <button
              className="btn btn-ghost small"
              onClick={() => void bloquear()}
              title="Cerrar sesión y volver a la pantalla de etiquetado"
            >
              <Unlock size={13} /> {ETIQUETA_ROL[rol]} · Bloquear
            </button>
          )}
        </nav>
      </header>

      <main style={{ paddingTop: 24 }}>
        {error && (
          <Aviso onCerrar={() => setError(null)}>
            {error}{" "}
            <button
              className="btn btn-ghost small"
              style={{ marginLeft: 8 }}
              onClick={() => void recargar()}
            >
              Reintentar
            </button>
          </Aviso>
        )}

        {vista === "etiquetar" && <EtiquetarView cat={cat} recargar={recargar} />}
        {vista === "lotes" && <LotesView cat={cat} recargar={recargar} />}
        {vista === "calidad" && <CalidadView cat={cat} recargar={recargar} />}
        {vista === "metricas" && <MetricasView cat={cat} />}
        {vista === "historial" && <HistorialView cat={cat} permisos={permisos} />}
        {vista === "config" && <ConfigView cat={cat} recargar={recargar} />}
      </main>

      {pidiendoPin && (
        <PinModal
          vista={pidiendoPin}
          onCancelar={() => setPidiendoPin(null)}
          onListo={async () => {
            const destino = pidiendoPin;
            setPidiendoPin(null);
            await recargar();
            ultimaActividad.current = Date.now();
            if (destino) setVista(destino);
          }}
        />
      )}
      </div>
    </>
  );
}
