"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, Layers, Play, Plus, Square, Trash2, X } from "lucide-react";
import {
  api,
  faltan,
  fechaHora,
  num,
  plural,
  type Catalogos,
  type LoteFila,
  type MaquinaCat,
  type Unidad,
} from "@/lib/cliente";
import { Aviso, Cargando, Modal } from "./ui";

/**
 * Pantalla del jefe de planta.
 *
 * Acá se abre cada lote con su límite. Si la máquina ya tiene uno corriendo, el
 * nuevo queda EN COLA: cuando el que está abierto llega a su límite se cierra
 * solo y el siguiente arranca automáticamente, así la línea no se detiene
 * esperando a nadie.
 *
 * La numeración de lotes es por producto: el 100 del 250ml y el 100 del 1L son
 * dos lotes distintos.
 */
export function LotesView({ cat, recargar }: { cat: Catalogos; recargar: () => Promise<void> }) {
  const [lotes, setLotes] = useState<LoteFila[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [abrirEn, setAbrirEn] = useState<MaquinaCat | null>(null);
  const [verCerrados, setVerCerrados] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setLotes(await api.get<LoteFila[]>("/api/lotes?limit=300"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los lotes.");
      setLotes([]);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function accion(fn: () => Promise<unknown>, mensaje: string) {
    setError(null);
    setOk(null);
    try {
      await fn();
      setOk(mensaje);
      await Promise.all([cargar(), recargar()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la acción.");
    }
  }

  if (lotes === null) return <Cargando texto="Cargando lotes..." />;

  const abiertos = lotes.filter((l) => l.estado === "abierto");
  const preparados = lotes.filter((l) => l.estado === "preparado");
  const cerrados = lotes.filter((l) => l.estado === "cerrado");
  const sinLote = cat.maquinas.filter((m) => !m.loteId);

  return (
    <div>
      {error && <Aviso onCerrar={() => setError(null)}>{error}</Aviso>}
      {ok && (
        <Aviso tipo="ok" onCerrar={() => setOk(null)}>
          {ok}
        </Aviso>
      )}

      {/* Lo primero que el jefe tiene que ver: máquinas paradas. */}
      {sinLote.length > 0 && (
        <div
          className="card"
          style={{
            padding: 18,
            marginBottom: 20,
            borderColor: "#5a2323",
            background: "var(--danger-dim)",
          }}
        >
          <div className="row" style={{ gap: 8, marginBottom: 10 }}>
            <AlertCircle size={17} style={{ color: "var(--danger)" }} />
            <span className="font-display" style={{ fontWeight: 700, fontSize: 17 }}>
              {sinLote.length === 1 ? "Una máquina parada" : `${sinLote.length} máquinas paradas`}
            </span>
          </div>
          <div className="small" style={{ color: "#ffc9c9", marginBottom: 12 }}>
            Sin lote abierto no se puede etiquetar. Abrí un lote para que la línea arranque.
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            {sinLote.map((m) => (
              <button key={m.id} className="btn btn-amber" onClick={() => setAbrirEn(m)}>
                <Play size={14} /> Abrir lote en {m.nombre}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Lotes corriendo */}
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <Layers size={17} style={{ color: "var(--amber)" }} />
        <span className="font-display" style={{ fontWeight: 700, fontSize: 18 }}>
          En producción
        </span>
      </div>

      {abiertos.length === 0 ? (
        <div className="card muted small" style={{ padding: 18, marginBottom: 22 }}>
          Ningún lote abierto.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))",
            gap: 14,
            marginBottom: 22,
          }}
        >
          {abiertos.map((l) => (
            <TarjetaLote
              key={l.id}
              l={l}
              enCola={cat.maquinas.find((m) => m.id === l.maquinaId)?.enCola ?? 0}
              onCerrar={() =>
                accion(
                  () => api.patch(`/api/lotes/${l.id}`, { accion: "cerrar" }),
                  `Lote ${l.codigo} cerrado.`
                )
              }
              onAbrirOtro={() => {
                const m = cat.maquinas.find((x) => x.id === l.maquinaId);
                if (m) setAbrirEn(m);
              }}
            />
          ))}
        </div>
      )}

      {/* Cola */}
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <span className="font-display" style={{ fontWeight: 700, fontSize: 18 }}>
          En cola
        </span>
        <span className="tiny muted">arrancan solos cuando el anterior llega a su límite</span>
      </div>

      {preparados.length === 0 ? (
        <div className="card muted small" style={{ padding: 18, marginBottom: 22 }}>
          Nada en cola. Si un lote llega a su límite y no hay siguiente preparado, la máquina queda
          parada hasta que abras uno.
        </div>
      ) : (
        <div className="card" style={{ overflow: "auto", marginBottom: 22 }}>
          <table className="hist">
            <thead>
              <tr>
                <th>Lote</th>
                <th>Máquina</th>
                <th>Producto</th>
                <th className="num">Límite</th>
                <th>Preparado</th>
                <th>Nota</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {preparados.map((l) => {
                const f = fechaHora(l.preparadoEn);
                return (
                  <tr key={l.id}>
                    <td>
                      <span className="chip chip-steel font-mono">{l.codigo}</span>
                    </td>
                    <td>{l.maquinaNombre}</td>
                    <td className="muted">{l.frascoNombre}</td>
                    <td className="num">
                      {num(l.limite)} {l.limiteUnidad === "cajas" ? "cajas" : "u."}
                    </td>
                    <td className="small muted">
                      {f.fecha} {f.hora} · {l.preparadoPor}
                    </td>
                    <td className="small muted">{l.nota ?? ""}</td>
                    <td>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: "4px 8px" }}
                        title="Cancelar este lote"
                        onClick={() =>
                          accion(
                            () => api.del(`/api/lotes/${l.id}`, {}),
                            `Lote ${l.codigo} cancelado. El número no se reutiliza.`
                          )
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Abrir uno nuevo */}
      <div className="row wrap" style={{ gap: 8, marginBottom: 22 }}>
        {cat.maquinas.map((m) => (
          <button key={m.id} className="btn btn-ghost" onClick={() => setAbrirEn(m)}>
            <Plus size={14} /> Lote en {m.nombre}
            {m.enCola > 0 && <span className="chip chip-steel">{m.enCola} en cola</span>}
          </button>
        ))}
      </div>

      {/* Cerrados */}
      <button
        className="btn btn-ghost small"
        onClick={() => setVerCerrados((v) => !v)}
        style={{ marginBottom: 12 }}
      >
        {verCerrados ? "Ocultar" : "Ver"} lotes cerrados ({cerrados.length})
      </button>

      {verCerrados && (
        <div className="card" style={{ overflow: "auto", maxHeight: 420 }}>
          <table className="hist">
            <thead>
              <tr>
                <th>Lote</th>
                <th>Máquina</th>
                <th>Producto</th>
                <th className="num">Límite</th>
                <th className="num">Producido</th>
                <th className="num">%</th>
                <th>Cerrado</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {cerrados.map((l) => {
                const f = fechaHora(l.cerradoEn);
                return (
                  <tr key={l.id} style={{ opacity: l.cerradoMotivo === "cancelado" ? 0.5 : 1 }}>
                    <td className="font-mono">{l.codigo}</td>
                    <td>{l.maquinaNombre}</td>
                    <td className="muted">{l.frascoNombre}</td>
                    <td className="num">{num(l.limite)}</td>
                    <td className="num">
                      {num(l.hecho)}
                      {l.excedente > 0 && (
                        <span className="tiny" style={{ color: "var(--amber)" }}>
                          {" "}
                          (+{l.excedente})
                        </span>
                      )}
                    </td>
                    <td className="num">{l.porcentaje}%</td>
                    <td className="small muted">
                      {f.fecha} {f.hora}
                    </td>
                    <td>
                      <MotivoCierre motivo={l.cerradoMotivo} por={l.cerradoPor} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {abrirEn && (
        <ModalAbrirLote
          maquina={abrirEn}
          cat={cat}
          onCerrar={() => setAbrirEn(null)}
          onHecho={async (mensaje) => {
            setAbrirEn(null);
            setOk(mensaje);
            await Promise.all([cargar(), recargar()]);
          }}
        />
      )}
    </div>
  );
}

function MotivoCierre({ motivo, por }: { motivo: string | null; por: string | null }) {
  if (motivo === "limite")
    return (
      <span className="chip chip-success" title="Se cerró solo al llegar al límite">
        <Check size={11} /> Completo
      </span>
    );
  if (motivo === "manual")
    return (
      <span className="chip chip-amber" title={por ? `Cerrado por ${por}` : ""}>
        A mano
      </span>
    );
  if (motivo === "cancelado")
    return (
      <span className="chip" style={{ background: "#2a2a2a", color: "#999", border: "1px solid #3a3a3a" }}>
        Cancelado
      </span>
    );
  return <span className="muted">—</span>;
}

function TarjetaLote({
  l,
  enCola,
  onCerrar,
  onAbrirOtro,
}: {
  l: LoteFila;
  enCola: number;
  onCerrar: () => void;
  onAbrirOtro: () => void;
}) {
  const unidad = l.limiteUnidad === "cajas" ? "cajas" : "unidades";
  const casiLleno = l.porcentaje >= 85;

  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <span className="chip chip-amber font-mono">{l.codigo}</span>
        {enCola > 0 ? (
          <span className="chip chip-steel">{enCola} en cola</span>
        ) : (
          casiLleno && (
            <span className="chip chip-danger" title="Si no hay siguiente, la máquina va a parar">
              Sin siguiente
            </span>
          )
        )}
      </div>

      <div className="font-display" style={{ fontWeight: 700, fontSize: 18 }}>
        {l.maquinaNombre}
      </div>
      <div className="small muted" style={{ marginBottom: 14 }}>
        {l.frascoNombre}
      </div>

      <div className="row" style={{ justifyContent: "space-between", marginBottom: 5 }}>
        <span className="font-mono" style={{ fontSize: 15 }}>
          {num(l.hecho)} <span className="muted">/ {num(l.limite)}</span>{" "}
          <span className="tiny muted">{unidad}</span>
        </span>
        <span
          className="font-mono"
          style={{ fontSize: 15, color: casiLleno ? "var(--amber)" : "var(--muted)", fontWeight: 700 }}
        >
          {l.porcentaje}%
        </span>
      </div>

      <div className="barra" style={{ marginBottom: 10 }}>
        <span
          style={{
            width: `${Math.min(l.porcentaje, 100)}%`,
            background: casiLleno ? "var(--danger)" : "var(--amber)",
          }}
        />
      </div>

      <div className="tiny muted" style={{ marginBottom: 14 }}>
        {l.restante > 0
          ? faltan(l.restante, l.limiteUnidad === "cajas" ? "cajas" : "unidades")
          : `Límite alcanzado${l.excedente > 0 ? ` (+${l.excedente} de excedente)` : ""}`}
        {" · "}
        {plural(l.progresoCajas, "caja")} / {num(l.progresoUnidades)} u.
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-ghost small grow" onClick={onAbrirOtro}>
          <Plus size={13} /> Preparar siguiente
        </button>
        <button className="btn btn-danger small" onClick={onCerrar} title="Cerrar antes del límite">
          <Square size={12} /> Cerrar
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ModalAbrirLote({
  maquina,
  cat,
  onCerrar,
  onHecho,
}: {
  maquina: MaquinaCat;
  cat: Catalogos;
  onCerrar: () => void;
  onHecho: (mensaje: string) => Promise<void>;
}) {
  const [frascoId, setFrascoId] = useState(String(maquina.frascoId ?? ""));
  const [unidad, setUnidad] = useState<Unidad>("unidades");
  const [limite, setLimite] = useState("");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const frasco = cat.frascos.find((f) => f.id === Number(frascoId));
  const estandar = frasco?.cantidadEstandar ?? null;
  const n = Number(limite);
  const valido = Number.isInteger(n) && n > 0 && !!frascoId;
  const arrancaYa = !maquina.loteId;
  const cambiaProducto = !!maquina.frascoId && Number(frascoId) !== maquina.frascoId;

  // Equivalencia entre las dos unidades, para que el jefe no calcule a mano.
  const equivalencia =
    estandar && n > 0
      ? unidad === "unidades"
        ? `≈ ${Math.ceil(n / estandar)} cajas de ${estandar} u.`
        : `≈ ${num(n * estandar)} unidades`
      : null;

  async function confirmar() {
    setEnviando(true);
    setError(null);
    try {
      const r = await api.post<{ lote: LoteFila; arrancoYa: boolean }>("/api/lotes", {
        maquinaId: maquina.id,
        frascoId: Number(frascoId),
        limite: n,
        limiteUnidad: unidad,
        nota: nota.trim() || undefined,
      });
      await onHecho(
        r.arrancoYa
          ? `Lote ${r.lote.codigo} abierto en ${maquina.nombre}. Ya se puede etiquetar.`
          : `Lote ${r.lote.codigo} preparado. Va a arrancar solo cuando se complete el actual.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir el lote.");
      setEnviando(false);
    }
  }

  return (
    <Modal
      titulo={arrancaYa ? `Abrir lote en ${maquina.nombre}` : `Preparar siguiente lote`}
      onCerrar={onCerrar}
      ancho={470}
    >
      {error && <Aviso onCerrar={() => setError(null)}>{error}</Aviso>}

      {!arrancaYa && (
        <Aviso tipo="info">
          {maquina.nombre} está produciendo el lote{" "}
          <b className="font-mono">{maquina.loteCodigo}</b>. Este queda en cola y arranca solo
          cuando ese llegue a su límite.
        </Aviso>
      )}

      <div className="tiny muted" style={{ marginBottom: 5 }}>
        PRODUCTO
      </div>
      <select
        className="input"
        style={{ width: "100%", marginBottom: cambiaProducto ? 6 : 14 }}
        value={frascoId}
        onChange={(ev) => setFrascoId(ev.target.value)}
      >
        <option value="">Elegí el producto...</option>
        {cat.frascos.map((f) => (
          <option key={f.id} value={f.id}>
            {f.nombre}
            {f.cantidadEstandar ? ` — ${f.cantidadEstandar} u./caja` : ""}
          </option>
        ))}
      </select>

      {cambiaProducto && (
        <div className="tiny" style={{ color: "var(--amber)", marginBottom: 14, lineHeight: 1.5 }}>
          Ojo: {maquina.nombre} venía haciendo {maquina.frascoNombre}. Al abrir este lote la máquina
          pasa a producir {frasco?.nombre}, y la numeración de lote sigue la secuencia de ese
          producto.
        </div>
      )}

      <div className="tiny muted" style={{ marginBottom: 5 }}>
        LÍMITE DEL LOTE
      </div>
      <div className="row" style={{ gap: 8, marginBottom: 6 }}>
        <input
          className="input font-mono grow"
          type="number"
          min={1}
          placeholder="Cantidad"
          value={limite}
          onChange={(ev) => setLimite(ev.target.value)}
          style={{ fontSize: 18 }}
        />
        <button
          className={`btn ${unidad === "unidades" ? "btn-amber" : "btn-ghost"} small`}
          onClick={() => setUnidad("unidades")}
        >
          Unidades
        </button>
        <button
          className={`btn ${unidad === "cajas" ? "btn-amber" : "btn-ghost"} small`}
          onClick={() => setUnidad("cajas")}
        >
          Cajas
        </button>
      </div>
      <div className="tiny muted" style={{ minHeight: 18, marginBottom: 14 }}>
        {equivalencia ?? (frascoId && !estandar ? "Este producto no tiene cantidad estándar cargada." : "")}
      </div>

      <div className="tiny muted" style={{ marginBottom: 5 }}>
        NOTA (opcional)
      </div>
      <input
        className="input"
        style={{ width: "100%", marginBottom: 6 }}
        placeholder="Ej: partida de materia prima 4471"
        value={nota}
        onChange={(ev) => setNota(ev.target.value)}
      />

      <div className="tiny muted" style={{ marginBottom: 18, lineHeight: 1.6 }}>
        El número de lote lo asigna el sistema siguiendo la secuencia de este producto. Las cajas de
        un lote nuevo arrancan siempre en <b style={{ color: "var(--text)" }}>#1</b>.
      </div>

      <div className="row" style={{ gap: 10 }}>
        <button
          className="btn btn-amber grow"
          style={{ padding: 12, fontSize: 16 }}
          disabled={!valido || enviando}
          onClick={confirmar}
        >
          {arrancaYa ? <Play size={15} /> : <Plus size={15} />}
          {enviando ? "Guardando..." : arrancaYa ? "Abrir lote" : "Poner en cola"}
        </button>
        <button className="btn btn-ghost" style={{ padding: "12px 16px" }} onClick={onCerrar}>
          <X size={15} /> Cancelar
        </button>
      </div>
    </Modal>
  );
}
