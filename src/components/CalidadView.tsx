"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, CheckCircle2, ShieldCheck, X } from "lucide-react";
import { api, fechaHora, num, qs, type Catalogos, type Etiqueta } from "@/lib/cliente";
import { Aviso, Cargando, EstadoVacio } from "./ui";

/**
 * Liberación de calidad. Igual que el artifact original, pero además permite
 * RECHAZAR (antes solo se podía liberar) y deja el dictamen auditado con
 * responsable, fecha y nota.
 */
export function CalidadView({ cat, recargar }: { cat: Catalogos; recargar: () => Promise<void> }) {
  const [filas, setFilas] = useState<Etiqueta[] | null>(null);
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [responsable, setResponsable] = useState("");
  const [nota, setNota] = useState("");
  const [lote, setLote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await api.get<{ filas: Etiqueta[] }>(
        `/api/etiquetas${qs({ estado: "pendiente", limit: 1000 })}`
      );
      setFilas(r.filas);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la lista.");
      setFilas([]);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const lotes = useMemo(
    () => Array.from(new Set((filas ?? []).map((f) => f.loteCodigo))).sort(),
    [filas]
  );
  const visibles = useMemo(
    () => (lote ? (filas ?? []).filter((f) => f.loteCodigo === lote) : (filas ?? [])),
    [filas, lote]
  );
  const unidadesSel = useMemo(
    () => (filas ?? []).filter((f) => seleccion.has(f.id)).reduce((a, f) => a + f.cantidad, 0),
    [filas, seleccion]
  );

  function alternar(id: number) {
    setSeleccion((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const todosVisiblesSel = visibles.length > 0 && visibles.every((f) => seleccion.has(f.id));

  function alternarTodos() {
    setSeleccion((s) => {
      const n = new Set(s);
      if (todosVisiblesSel) visibles.forEach((f) => n.delete(f.id));
      else visibles.forEach((f) => n.add(f.id));
      return n;
    });
  }

  async function dictaminar(estado: "liberada" | "rechazada") {
    if (!seleccion.size || !responsable.trim()) return;
    setGuardando(true);
    setError(null);
    setOkMsg(null);
    try {
      const r = await api.post<{ afectadas: number[] }>("/api/etiquetas/calidad", {
        etiquetaIds: [...seleccion],
        estado,
        por: responsable.trim(),
        nota: nota.trim() || undefined,
      });
      setOkMsg(
        `${r.afectadas.length} caja${r.afectadas.length > 1 ? "s" : ""} ${
          estado === "liberada" ? "liberada" : "rechazada"
        }${r.afectadas.length > 1 ? "s" : ""}.`
      );
      setSeleccion(new Set());
      setNota("");
      await Promise.all([cargar(), recargar()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el dictamen.");
    } finally {
      setGuardando(false);
    }
  }

  if (filas === null) return <Cargando texto="Cargando pendientes..." />;

  if (filas.length === 0) {
    return (
      <div>
        {okMsg && (
          <Aviso tipo="ok" onCerrar={() => setOkMsg(null)}>
            {okMsg}
          </Aviso>
        )}
        <EstadoVacio
          icon={<CheckCircle2 size={26} />}
          titulo="No hay cajas pendientes de liberación"
          texto="Todas las cajas etiquetadas ya tienen dictamen de Calidad. Las nuevas van a aparecer acá automáticamente."
        />
      </div>
    );
  }

  return (
    <div>
      {error && <Aviso onCerrar={() => setError(null)}>{error}</Aviso>}
      {okMsg && (
        <Aviso tipo="ok" onCerrar={() => setOkMsg(null)}>
          {okMsg}
        </Aviso>
      )}

      <div className="row" style={{ marginBottom: 4 }}>
        <ShieldCheck size={18} style={{ color: "var(--amber)" }} />
        <div className="font-display" style={{ fontWeight: 700, fontSize: 19 }}>
          Cajas pendientes de dictamen
        </div>
      </div>
      <div className="small muted" style={{ marginBottom: 16 }}>
        Seleccioná las cajas revisadas, indicá quién dictamina y confirmá. Al resolverlas salen de
        esta lista y quedan marcadas en el historial con tu nombre y la fecha.
      </div>

      <div className="row wrap" style={{ marginBottom: 14, gap: 12 }}>
        <select
          className="input"
          value={lote}
          onChange={(ev) => {
            setLote(ev.target.value);
            setSeleccion(new Set());
          }}
        >
          <option value="">Todos los lotes ({filas.length})</option>
          {lotes.map((l) => (
            <option key={l} value={l}>
              Lote {l} ({filas.filter((f) => f.loteCodigo === l).length})
            </option>
          ))}
        </select>
        <button className="btn btn-ghost small" onClick={alternarTodos}>
          {todosVisiblesSel ? "Deseleccionar todo" : "Seleccionar todo"}
        </button>
        <div className="ml-auto small muted">
          {seleccion.size} seleccionadas ·{" "}
          <span className="font-mono" style={{ color: "var(--text)" }}>
            {num(unidadesSel)}
          </span>{" "}
          unidades
        </div>
      </div>

      <div className="card" style={{ overflow: "auto", maxHeight: 420, marginBottom: 16 }}>
        <table className="hist">
          <thead>
            <tr>
              <th style={{ width: 42 }} />
              <th>Fecha</th>
              <th>Máquina</th>
              <th>Frasco</th>
              <th>Lote</th>
              <th className="num">Caja</th>
              <th className="num">Cant.</th>
              <th>Turno</th>
              <th>Operario</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((f) => {
              const sel = seleccion.has(f.id);
              const { fecha, hora } = fechaHora(f.creadoEn);
              return (
                <tr
                  key={f.id}
                  onClick={() => alternar(f.id)}
                  style={{ cursor: "pointer", background: sel ? "var(--amber-dim)" : undefined }}
                >
                  <td>
                    <div
                      role="checkbox"
                      aria-checked={sel}
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 5,
                        border: `1.5px solid ${sel ? "var(--amber)" : "var(--border)"}`,
                        background: sel ? "var(--amber)" : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {sel && <Check size={12} color="#1a1200" />}
                    </div>
                  </td>
                  <td>
                    {fecha} <span className="font-mono muted">{hora}</span>
                  </td>
                  <td>{f.maquinaNombre}</td>
                  <td>{f.frascoNombre}</td>
                  <td className="font-mono">{f.loteCodigo}</td>
                  <td className="num">#{f.caja}</td>
                  <td className="num">{f.cantidad}</td>
                  <td>
                    <span className="chip chip-steel">{f.turno}</span>
                  </td>
                  <td>{f.operarioNombre}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div className="row wrap" style={{ gap: 12, alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="tiny muted" style={{ marginBottom: 5 }}>
              RESPONSABLE DE CALIDAD
            </div>
            <input
              className="input"
              style={{ width: "100%" }}
              placeholder="Nombre y apellido"
              value={responsable}
              onChange={(ev) => setResponsable(ev.target.value)}
            />
          </div>
          <div style={{ flex: 2, minWidth: 240 }}>
            <div className="tiny muted" style={{ marginBottom: 5 }}>
              NOTA (opcional, queda en el historial)
            </div>
            <input
              className="input"
              style={{ width: "100%" }}
              placeholder="Ej: control dimensional OK"
              value={nota}
              onChange={(ev) => setNota(ev.target.value)}
            />
          </div>
        </div>

        <div className="row wrap" style={{ gap: 10, marginTop: 14 }}>
          <button
            className="btn btn-success"
            style={{ padding: "12px 22px", fontSize: 16 }}
            disabled={!seleccion.size || !responsable.trim() || guardando}
            onClick={() => dictaminar("liberada")}
          >
            <CheckCircle2 size={17} /> Liberar {seleccion.size || ""}
          </button>
          <button
            className="btn btn-danger"
            style={{ padding: "12px 22px", fontSize: 16 }}
            disabled={!seleccion.size || !responsable.trim() || guardando}
            onClick={() => dictaminar("rechazada")}
          >
            <X size={17} /> Rechazar {seleccion.size || ""}
          </button>
          {!responsable.trim() && seleccion.size > 0 && (
            <span className="small muted">Falta indicar quién dictamina.</span>
          )}
        </div>
      </div>
    </div>
  );
}
