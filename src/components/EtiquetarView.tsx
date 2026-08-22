"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Delete,
  Factory,
  Printer,
  Users,
} from "lucide-react";
import { api, faltan, num, plural, type Catalogos, type Etiqueta, type MaquinaCat } from "@/lib/cliente";
import { TicketEtiqueta, ZonaImpresion } from "./Etiqueta";
import { Aviso, EstadoVacio } from "./ui";

/**
 * Pantalla de etiquetado. Mismo flujo de 4 pasos del artifact original:
 * máquina -> operario -> turno -> cantidad.
 *
 * Diferencia clave con el original: el número de caja ya NO se calcula acá.
 * El "próxima caja #N" que se muestra es informativo y viene del servidor; el
 * número real lo asigna la base al insertar, dentro de una transacción.
 */
export function EtiquetarView({
  cat,
  recargar,
}: {
  cat: Catalogos;
  recargar: () => Promise<void>;
}) {
  const [maquinaId, setMaquinaId] = useState<number | null>(null);
  const [operarioId, setOperarioId] = useState<number | null>(null);
  const [turno, setTurno] = useState<string | null>(null);
  const [cantidad, setCantidad] = useState("");
  const [editandoCantidad, setEditandoCantidad] = useState(false);
  const [ultima, setUltima] = useState<Etiqueta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [avisoLote, setAvisoLote] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);

  const maquina = useMemo(
    () => cat.maquinas.find((m) => m.id === maquinaId) ?? null,
    [cat.maquinas, maquinaId]
  );
  const operario = useMemo(
    () => cat.operarios.find((o) => o.id === operarioId) ?? null,
    [cat.operarios, operarioId]
  );

  const estandar = maquina?.cantidadEstandar ?? null;
  const hayEstandar = estandar !== null;

  const paso = !maquinaId ? 1 : !operarioId ? 2 : !turno ? 3 : 4;
  const puedeGenerar = !!maquina && !!operario && !!turno && Number(cantidad) > 0 && !generando;

  // Al entrar al paso 4, precargar la cantidad estándar del frasco.
  useEffect(() => {
    if (turno) {
      setEditandoCantidad(false);
      setCantidad(hayEstandar ? String(estandar) : "");
    } else {
      setCantidad("");
      setEditandoCantidad(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turno, maquinaId]);

  function reiniciarTodo() {
    setMaquinaId(null);
    setOperarioId(null);
    setTurno(null);
    setCantidad("");
    setEditandoCantidad(false);
    setError(null);
  }

  async function generar() {
    if (!puedeGenerar || !maquina || !operario || !turno) return;
    setGenerando(true);
    setError(null);
    try {
      const e = await api.post<Etiqueta>("/api/etiquetas", {
        maquinaId: maquina.id,
        operarioId: operario.id,
        turno,
        cantidad: Number(cantidad),
      });
      setUltima(e);

      // Si esta caja completó el lote, avisarlo fuerte: el operario tiene que
      // saber que la próxima caja ya es de otro lote (o que no puede seguir).
      if (e.lote?.cerrado) {
        setAvisoLote(
          e.lote.siguiente
            ? `El lote ${e.lote.cerrado} llegó a su límite y se cerró. Arrancó el ${e.lote.siguiente}: la próxima caja es la #1.`
            : `El lote ${e.lote.cerrado} llegó a su límite y se cerró. NO hay otro lote preparado: avisale al jefe de planta para poder seguir.`
        );
      } else {
        setAvisoLote(null);
      }

      // Mantiene máquina/operario/turno: el operario sigue con la caja siguiente.
      setEditandoCantidad(false);
      setCantidad(hayEstandar ? String(estandar) : "");
      // Refresca el progreso y el "próxima caja #N" desde el servidor.
      await recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar la etiqueta.");
    } finally {
      setGenerando(false);
    }
  }

  async function imprimir(e: Etiqueta) {
    // Registra la impresión antes de abrir el diálogo: si el operario cancela,
    // igual queda constancia de que se intentó. Es lo prudente en trazabilidad.
    try {
      await api.post(`/api/etiquetas/${e.id}/imprimir`);
    } catch {
      /* si falla el conteo, imprimir de todas formas */
    }
    window.print();
  }

  // Nada de imprimir automático: window.print() abre un diálogo modal que
  // bloquea la pantalla, y el operario tendría que cerrarlo en cada caja.
  // En el paso 3, con ZPL por TCP, la impresión sale sola y sin diálogo: ahí
  // "Generar" y "Imprimir" vuelven a ser un solo toque.

  // --- Estados vacíos -------------------------------------------------------
  if (cat.maquinas.length === 0) {
    return (
      <EstadoVacio
        icon={<Factory size={26} />}
        titulo="Todavía no hay máquinas cargadas"
        texto="Andá a Configuración para dar de alta la primera máquina y su frasco."
      />
    );
  }
  if (cat.operarios.length === 0) {
    return (
      <EstadoVacio
        icon={<Users size={26} />}
        titulo="Todavía no hay operarios cargados"
        texto="Andá a Configuración para agregar los nombres de los operarios de planta."
      />
    );
  }

  const pasos = ["Máquina", "Operario", "Turno", "Cantidad"];

  return (
    <div className="etiquetar-grid">
      <div style={{ minWidth: 0 }}>
        {error && <Aviso onCerrar={() => setError(null)}>{error}</Aviso>}
        {avisoLote && (
          <Aviso
            tipo={avisoLote.includes("NO hay otro lote") ? "error" : "info"}
            onCerrar={() => setAvisoLote(null)}
          >
            {avisoLote}
          </Aviso>
        )}

        {/* Stepper */}
        <div className="row wrap" style={{ marginBottom: 20 }}>
          {pasos.map((rotulo, i) => {
            const n = i + 1;
            const estado = n < paso ? "done" : n === paso ? "active" : "";
            return (
              <div className="row" key={rotulo}>
                <div className={`step-dot ${estado}`}>{n < paso ? <Check size={13} /> : n}</div>
                <span
                  className="font-display small"
                  style={{ color: n === paso ? "var(--amber)" : "var(--muted)" }}
                >
                  {rotulo}
                </span>
                {i < 3 && <ChevronRight size={14} style={{ color: "var(--border)" }} />}
              </div>
            );
          })}
          {(maquinaId || operarioId || turno) && (
            <button className="btn btn-ghost ml-auto small" onClick={reiniciarTodo}>
              Empezar de nuevo
            </button>
          )}
        </div>

        {/* Paso 1: máquina */}
        {paso === 1 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
              gap: 12,
            }}
          >
            {cat.maquinas.map((m) => (
              <TileMaquina key={m.id} m={m} onElegir={() => setMaquinaId(m.id)} />
            ))}
          </div>
        )}

        {/* Paso 2: operario */}
        {paso === 2 && (
          <div>
            <Resumen maquina={maquina} onAtras={() => setMaquinaId(null)} />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
                gap: 12,
                marginTop: 16,
              }}
            >
              {cat.operarios.map((o) => (
                <button
                  key={o.id}
                  className="tile-btn font-display"
                  style={{ textAlign: "center", fontWeight: 700, fontSize: 18 }}
                  onClick={() => setOperarioId(o.id)}
                >
                  {o.nombre}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Paso 3: turno */}
        {paso === 3 && (
          <div>
            <Resumen
              maquina={maquina}
              operario={operario?.nombre}
              onAtras={() => setOperarioId(null)}
            />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
                gap: 12,
                marginTop: 16,
              }}
            >
              {cat.turnos.map((t) => (
                <button
                  key={t.id}
                  className="tile-btn font-display"
                  style={{ fontWeight: 700, fontSize: 18 }}
                  onClick={() => setTurno(t.nombre)}
                >
                  <span
                    className="row"
                    style={{ justifyContent: "center", gap: 8 }}
                  >
                    <Clock size={16} /> {t.nombre}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Paso 4: cantidad */}
        {paso === 4 && (
          <div>
            <Resumen
              maquina={maquina}
              operario={operario?.nombre}
              turno={turno ?? undefined}
              onAtras={() => setTurno(null)}
            />

            <div className="cantidad-grid">
              <div>
                <div className="tiny muted" style={{ marginBottom: 8, letterSpacing: ".05em" }}>
                  {hayEstandar && !editandoCantidad
                    ? "UNIDADES EN LA CAJA"
                    : hayEstandar
                      ? "CANTIDAD MANUAL PARA ESTA CAJA"
                      : "UNIDADES EN LA CAJA"}
                </div>

                {!hayEstandar && (
                  <div className="tiny" style={{ color: "var(--danger)", marginBottom: 8 }}>
                    Este frasco no tiene cantidad estándar cargada. Configurala en Frascos, o
                    ingresá el valor esta vez.
                  </div>
                )}

                <div
                  className="card font-mono"
                  style={{
                    fontSize: 40,
                    fontWeight: 700,
                    textAlign: "center",
                    padding: "14px 8px",
                    marginBottom: 10,
                    color: cantidad ? "var(--text)" : "var(--muted)",
                    background: "var(--panel-alt)",
                  }}
                >
                  {cantidad || "0"}
                </div>

                {hayEstandar && !editandoCantidad ? (
                  <>
                    <span className="chip chip-steel">Cantidad estándar del frasco</span>
                    <button
                      className="btn btn-ghost small"
                      style={{ width: "100%", marginTop: 12 }}
                      onClick={() => {
                        setEditandoCantidad(true);
                        setCantidad("");
                      }}
                    >
                      Esta caja tiene otra cantidad
                    </button>
                  </>
                ) : (
                  <>
                    <Teclado valor={cantidad} onCambio={setCantidad} />
                    {hayEstandar && (
                      <button
                        className="btn btn-ghost small"
                        style={{ width: "100%", marginTop: 12 }}
                        onClick={() => {
                          setEditandoCantidad(false);
                          setCantidad(String(estandar));
                        }}
                      >
                        Volver a la estándar ({estandar})
                      </button>
                    )}
                  </>
                )}
              </div>

              <div className="col" style={{ justifyContent: "flex-end" }}>
                <button
                  className="btn btn-amber"
                  style={{ padding: "18px 20px", fontSize: 20 }}
                  disabled={!puedeGenerar}
                  onClick={generar}
                >
                  <Printer size={20} />
                  {generando ? "Generando..." : "Generar etiqueta"}
                </button>
                {maquina && <ProgresoLote m={maquina} />}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Panel derecho: última etiqueta */}
      <div>
        <div className="tiny muted" style={{ marginBottom: 8, letterSpacing: ".05em" }}>
          ÚLTIMA ETIQUETA GENERADA
        </div>
        {!ultima ? (
          <div
            className="card row muted"
            style={{ height: 300, justifyContent: "center", textAlign: "center", padding: 24 }}
          >
            Acá vas a ver la vista previa apenas generes una etiqueta.
          </div>
        ) : (
          <div>
            <TicketEtiqueta e={ultima} />
            <button
              className={ultima.impresiones === 0 ? "btn btn-amber" : "btn btn-ghost"}
              style={{ width: "100%", marginTop: 12, padding: 13, fontSize: 16 }}
              onClick={() => imprimir(ultima)}
            >
              <Printer size={17} />
              {ultima.impresiones === 0 ? "Imprimir etiqueta" : "Reimprimir"}
            </button>
            {ultima.impresiones > 0 && (
              <div className="tiny muted" style={{ marginTop: 6, textAlign: "center" }}>
                Impresa {ultima.impresiones} {ultima.impresiones === 1 ? "vez" : "veces"} · las
                reimpresiones quedan auditadas
              </div>
            )}
          </div>
        )}
      </div>

      <ZonaImpresion e={ultima} />
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Progreso del lote contra su límite, para que el operario vea cuánto falta. */
function ProgresoLote({ m }: { m: MaquinaCat }) {
  if (!m.loteId || m.limite === null) return null;
  const unidad = m.limiteUnidad === "cajas" ? "cajas" : "u.";
  const casiLleno = m.porcentaje >= 85;

  return (
    <div style={{ marginTop: 10 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <span className="tiny muted">
          Lote <span className="font-mono" style={{ color: "var(--amber)" }}>{m.loteCodigo}</span>
          {" · próxima caja "}
          <span className="font-mono" style={{ color: "var(--amber)" }}>#{m.proximaCaja}</span>
        </span>
        <span className="tiny font-mono" style={{ color: casiLleno ? "var(--amber)" : "var(--muted)" }}>
          {num(m.hecho)} / {num(m.limite)} {unidad}
        </span>
      </div>
      <div className="barra">
        <span
          style={{
            width: `${Math.min(m.porcentaje, 100)}%`,
            background: casiLleno ? "var(--danger)" : "var(--amber)",
          }}
        />
      </div>
      <div className="tiny muted" style={{ marginTop: 4 }}>
        {/*
          El lote NO se cierra al llegar al objetivo: sigue abierto hasta que el
          jefe cambie la produccion de la maquina. Por eso acá ya no hay ninguna
          advertencia de "la línea va a parar" -- sola no para. El operario
          etiqueta y listo.
        */}
        {m.restante > 0 ? (
          <>{faltan(m.restante, m.limiteUnidad === "cajas" ? "cajas" : "unidades")} para el objetivo</>
        ) : (
          <span style={{ color: "var(--success)" }}>
            Objetivo cumplido · {m.porcentaje}%
          </span>
        )}
      </div>
    </div>
  );
}

function TileMaquina({ m, onElegir }: { m: MaquinaCat; onElegir: () => void }) {
  const sinLote = !m.loteId;
  return (
    <button className="tile-btn" onClick={onElegir} disabled={sinLote} title={sinLote ? "Sin lote abierto" : ""}>
      <div className="font-display" style={{ fontWeight: 700, fontSize: 18, marginBottom: 3 }}>
        {m.nombre}
      </div>
      <div className="small muted" style={{ marginBottom: 8 }}>
        {m.frascoNombre ?? "sin frasco"}
      </div>
      {sinLote ? (
        <>
          <span className="chip chip-danger">Sin lote abierto</span>
          <div className="tiny muted" style={{ marginTop: 8 }}>
            El jefe de planta tiene que abrir un lote
          </div>
        </>
      ) : (
        <>
          <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
            <span className="chip chip-amber font-mono">{m.loteCodigo}</span>
            <span className="tiny muted font-mono">próx. #{m.proximaCaja}</span>
          </div>
          {m.limite !== null && (
            <>
              <div className="barra" style={{ marginBottom: 4 }}>
                <span
                  style={{
                    width: `${Math.min(m.porcentaje, 100)}%`,
                    background: m.porcentaje >= 85 ? "var(--danger)" : "var(--amber)",
                  }}
                />
              </div>
              <div className="tiny muted font-mono">
                {num(m.hecho)} / {num(m.limite)} {m.limiteUnidad === "cajas" ? "cajas" : "u."}
              </div>
            </>
          )}
        </>
      )}
    </button>
  );
}

function Resumen({
  maquina,
  operario,
  turno,
  onAtras,
}: {
  maquina: MaquinaCat | null;
  operario?: string;
  turno?: string;
  onAtras: () => void;
}) {
  return (
    <div className="row wrap">
      <button className="btn btn-ghost small" onClick={onAtras}>
        <ChevronLeft size={14} /> Atrás
      </button>
      {maquina && <span className="chip chip-steel">{maquina.nombre}</span>}
      {maquina?.loteCodigo && <span className="chip chip-amber font-mono">{maquina.loteCodigo}</span>}
      {operario && <span className="chip chip-steel">{operario}</span>}
      {turno && <span className="chip chip-steel">{turno}</span>}
    </div>
  );
}

function Teclado({ valor, onCambio }: { valor: string; onCambio: (v: string) => void }) {
  const agregar = (d: string) => onCambio((valor + d).slice(0, 6));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
        <button key={d} className="keypad-btn" onClick={() => agregar(d)}>
          {d}
        </button>
      ))}
      <button className="keypad-btn" onClick={() => onCambio("")} aria-label="Borrar todo">
        C
      </button>
      <button className="keypad-btn" onClick={() => agregar("0")}>
        0
      </button>
      <button
        className="keypad-btn"
        onClick={() => onCambio(valor.slice(0, -1))}
        aria-label="Borrar último dígito"
      >
        <Delete size={20} />
      </button>
    </div>
  );
}
