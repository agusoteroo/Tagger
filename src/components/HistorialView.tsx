"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, History, Printer, Search, Trash2, X } from "lucide-react";
import {
  api,
  fechaHora,
  hoyISO,
  num,
  qs,
  type Catalogos,
  type Etiqueta,
  type Permiso,
} from "@/lib/cliente";
import { TicketEtiqueta, ZonaImpresion } from "./Etiqueta";
import { Aviso, Cargando, ChipCalidad, EstadoVacio, Modal } from "./ui";

/**
 * Historial con los filtros que hacen falta para medir: operario, máquina,
 * turno, estado y RANGO DE FECHAS. El artifact original solo tenía búsqueda de
 * texto libre y filtro por máquina, y eso no sirve para sacar números.
 *
 * El export usa exactamente los mismos filtros que la tabla, así que el archivo
 * descargado siempre coincide con lo que se ve en pantalla.
 */

type Filtros = {
  q: string;
  desde: string;
  hasta: string;
  operarioId: string;
  maquina: string;
  turno: string;
  estado: string;
  soloAnuladas: boolean;
};

const VACIO: Filtros = {
  q: "",
  desde: "",
  hasta: "",
  operarioId: "",
  maquina: "",
  turno: "",
  estado: "",
  soloAnuladas: false,
};

const POR_PAGINA = 100;

export function HistorialView({ cat, permisos }: { cat: Catalogos; permisos: Permiso[] }) {
  const [f, setF] = useState<Filtros>(VACIO);
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState<{ filas: Etiqueta[]; total: number; unidades: number } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [reimprimir, setReimprimir] = useState<Etiqueta | null>(null);
  const [anular, setAnular] = useState<Etiqueta | null>(null);

  const consulta = qs({
    q: f.q,
    desde: f.desde,
    hasta: f.hasta,
    operarioId: f.operarioId,
    maquina: f.maquina,
    turno: f.turno,
    estado: f.estado,
    soloAnuladas: f.soloAnuladas ? "1" : "",
    // Con un filtro de estado puesto, incluir anuladas confundiría el conteo.
    incluirAnuladas: !f.soloAnuladas && !f.estado ? "1" : "",
  });

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const r = await api.get<{ filas: Etiqueta[]; total: number; unidades: number }>(
        `/api/etiquetas${consulta}${consulta ? "&" : "?"}limit=${POR_PAGINA}&offset=${pagina * POR_PAGINA}`
      );
      setDatos(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el historial.");
    }
  }, [consulta, pagina]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function cambiar<K extends keyof Filtros>(k: K, v: Filtros[K]) {
    setF((prev) => ({ ...prev, [k]: v }));
    setPagina(0);
  }

  const hayFiltros = JSON.stringify(f) !== JSON.stringify(VACIO);

  async function imprimir(e: Etiqueta) {
    try {
      await api.post(`/api/etiquetas/${e.id}/imprimir`);
      await cargar();
    } catch {
      /* imprimir igual */
    }
    window.print();
  }

  if (datos === null && !error) return <Cargando texto="Cargando historial..." />;

  return (
    <div>
      {error && <Aviso onCerrar={() => setError(null)}>{error}</Aviso>}

      {/* --- Filtros --- */}
      <div className="row wrap" style={{ gap: 10, marginBottom: 14 }}>
        <div className="row" style={{ position: "relative" }}>
          <Search
            size={14}
            style={{ position: "absolute", left: 10, color: "var(--muted)", pointerEvents: "none" }}
          />
          <input
            className="input"
            style={{ paddingLeft: 30, width: 210 }}
            placeholder="Lote, operario, caja..."
            value={f.q}
            onChange={(ev) => cambiar("q", ev.target.value)}
          />
        </div>

        <select
          className="input"
          value={f.operarioId}
          onChange={(ev) => cambiar("operarioId", ev.target.value)}
        >
          <option value="">Todos los operarios</option>
          {cat.operarios.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nombre}
            </option>
          ))}
        </select>

        <select className="input" value={f.maquina} onChange={(ev) => cambiar("maquina", ev.target.value)}>
          <option value="">Todas las máquinas</option>
          {cat.maquinas.map((m) => (
            <option key={m.id} value={m.nombre}>
              {m.nombre}
            </option>
          ))}
        </select>

        <select className="input" value={f.turno} onChange={(ev) => cambiar("turno", ev.target.value)}>
          <option value="">Todos los turnos</option>
          {cat.turnos.map((t) => (
            <option key={t.id} value={t.nombre}>
              {t.nombre}
            </option>
          ))}
        </select>

        <select className="input" value={f.estado} onChange={(ev) => cambiar("estado", ev.target.value)}>
          <option value="">Toda calidad</option>
          <option value="pendiente">Pendientes</option>
          <option value="liberada">Liberadas</option>
          <option value="rechazada">Rechazadas</option>
        </select>
      </div>

      <div className="row wrap" style={{ gap: 10, marginBottom: 14 }}>
        <span className="tiny muted">DESDE</span>
        <input
          className="input"
          type="date"
          value={f.desde}
          max={f.hasta || undefined}
          onChange={(ev) => cambiar("desde", ev.target.value)}
        />
        <span className="tiny muted">HASTA</span>
        <input
          className="input"
          type="date"
          value={f.hasta}
          min={f.desde || undefined}
          onChange={(ev) => cambiar("hasta", ev.target.value)}
        />
        <button className="btn btn-ghost small" onClick={() => setF((p) => ({ ...p, desde: hoyISO(), hasta: hoyISO() }))}>
          Hoy
        </button>
        <button
          className="btn btn-ghost small"
          onClick={() => setF((p) => ({ ...p, desde: hoyISO(-6), hasta: hoyISO() }))}
        >
          7 días
        </button>
        <button
          className="btn btn-ghost small"
          onClick={() => setF((p) => ({ ...p, desde: hoyISO(-29), hasta: hoyISO() }))}
        >
          30 días
        </button>

        <label className="row small muted" style={{ gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={f.soloAnuladas}
            onChange={(ev) => cambiar("soloAnuladas", ev.target.checked)}
          />
          Solo anuladas
        </label>

        {hayFiltros && (
          <button className="btn btn-ghost small" onClick={() => { setF(VACIO); setPagina(0); }}>
            <X size={13} /> Limpiar
          </button>
        )}

        <div className="ml-auto row" style={{ gap: 12 }}>
          <span className="small muted">
            {num(datos?.total ?? 0)} cajas ·{" "}
            <span className="font-mono" style={{ color: "var(--text)" }}>
              {num(datos?.unidades ?? 0)}
            </span>{" "}
            unidades
          </span>
          <a className="btn btn-ghost small" href={`/api/export${consulta}`}>
            <Download size={14} /> Exportar
          </a>
        </div>
      </div>

      {/* --- Tabla --- */}
      {datos && datos.total === 0 ? (
        <EstadoVacio
          icon={<History size={26} />}
          titulo={hayFiltros ? "Ninguna caja coincide con esos filtros" : "Todavía no se generaron etiquetas"}
          texto={
            hayFiltros
              ? "Probá ampliar el rango de fechas o limpiar algún filtro."
              : "Cuando se cierre la primera caja desde Etiquetar, va a aparecer acá con trazabilidad completa."
          }
        />
      ) : (
        <>
          <div className="card" style={{ overflow: "auto", maxHeight: 540 }}>
            <table className="hist">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Hora</th>
                  <th>Máquina</th>
                  <th>Frasco</th>
                  <th>Lote</th>
                  <th className="num">Caja</th>
                  <th className="num">Cant.</th>
                  <th>Turno</th>
                  <th>Operario</th>
                  <th>Calidad</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {datos?.filas.map((e) => {
                  const { fecha, hora } = fechaHora(e.creadoEn);
                  const cal = fechaHora(e.calidadEn);
                  return (
                    <tr key={e.id} style={{ opacity: e.anulada ? 0.5 : 1 }}>
                      <td>{fecha}</td>
                      <td className="font-mono">{hora}</td>
                      <td>{e.maquinaNombre}</td>
                      <td>{e.frascoNombre}</td>
                      <td className="font-mono">{e.loteCodigo}</td>
                      <td className="num">#{e.caja}</td>
                      <td className="num">{e.cantidad}</td>
                      <td>
                        <span className="chip chip-steel">{e.turno}</span>
                      </td>
                      <td>{e.operarioNombre}</td>
                      <td>
                        <ChipCalidad
                          estado={e.estadoCalidad}
                          por={e.calidadPor}
                          cuando={cal.fecha ? `${cal.fecha} ${cal.hora}` : null}
                          anulada={e.anulada}
                        />
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          <button
                            className="btn btn-ghost"
                            style={{ padding: "4px 8px" }}
                            title="Ver y reimprimir"
                            onClick={() => setReimprimir(e)}
                          >
                            <Printer size={13} />
                          </button>
                          {permisos.includes("anular") && !e.anulada && (
                            <button
                              className="btn btn-ghost"
                              style={{ padding: "4px 8px" }}
                              title="Anular esta caja"
                              onClick={() => setAnular(e)}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {(datos?.total ?? 0) > POR_PAGINA && (
            <div className="row" style={{ justifyContent: "center", gap: 12, marginTop: 14 }}>
              <button
                className="btn btn-ghost small"
                disabled={pagina === 0}
                onClick={() => setPagina((p) => p - 1)}
              >
                Anterior
              </button>
              <span className="small muted">
                {pagina * POR_PAGINA + 1}–{Math.min((pagina + 1) * POR_PAGINA, datos!.total)} de{" "}
                {num(datos!.total)}
              </span>
              <button
                className="btn btn-ghost small"
                disabled={(pagina + 1) * POR_PAGINA >= (datos?.total ?? 0)}
                onClick={() => setPagina((p) => p + 1)}
              >
                Siguiente
              </button>
            </div>
          )}
        </>
      )}

      {reimprimir && (
        <Modal titulo={`Caja #${reimprimir.caja} · ${reimprimir.loteCodigo}`} onCerrar={() => setReimprimir(null)} ancho={420}>
          <TicketEtiqueta e={reimprimir} />
          {reimprimir.impresiones > 0 && (
            <div className="tiny muted" style={{ marginTop: 10 }}>
              Ya se imprimió {reimprimir.impresiones}{" "}
              {reimprimir.impresiones === 1 ? "vez" : "veces"}. Las reimpresiones quedan auditadas.
            </div>
          )}
          <div className="row" style={{ gap: 10, marginTop: 14 }}>
            <button
              className="btn btn-amber grow"
              style={{ padding: 11 }}
              onClick={() => imprimir(reimprimir)}
            >
              <Printer size={16} /> Imprimir
            </button>
            <button className="btn btn-ghost" style={{ padding: "11px 16px" }} onClick={() => setReimprimir(null)}>
              Cerrar
            </button>
          </div>
        </Modal>
      )}

      {anular && (
        <ModalAnular
          e={anular}
          onCerrar={() => setAnular(null)}
          onHecho={async () => {
            setAnular(null);
            await cargar();
          }}
        />
      )}

      <ZonaImpresion e={reimprimir} />
    </div>
  );
}

function ModalAnular({
  e,
  onCerrar,
  onHecho,
}: {
  e: Etiqueta;
  onCerrar: () => void;
  onHecho: () => Promise<void>;
}) {
  const [por, setPor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    setEnviando(true);
    setError(null);
    try {
      await api.post(`/api/etiquetas/${e.id}/anular`, { por: por.trim(), motivo: motivo.trim() });
      await onHecho();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo anular.");
      setEnviando(false);
    }
  }

  return (
    <Modal titulo={`Anular caja #${e.caja}`} onCerrar={onCerrar}>
      {error && <Aviso onCerrar={() => setError(null)}>{error}</Aviso>}

      <div className="small muted" style={{ marginBottom: 14, lineHeight: 1.5 }}>
        La caja <b style={{ color: "var(--text)" }}>#{e.caja}</b> del lote{" "}
        <b className="font-mono" style={{ color: "var(--amber)" }}>
          {e.loteCodigo}
        </b>{" "}
        no se borra: queda marcada como anulada, con tu nombre y el motivo. El número{" "}
        <b style={{ color: "var(--text)" }}>#{e.caja}</b> no se reutiliza — el hueco en la secuencia
        es la evidencia de que ahí hubo una caja.
      </div>

      <div className="tiny muted" style={{ marginBottom: 5 }}>
        QUIÉN ANULA
      </div>
      <input
        className="input"
        style={{ width: "100%", marginBottom: 12 }}
        placeholder="Nombre y apellido"
        value={por}
        onChange={(ev) => setPor(ev.target.value)}
      />

      <div className="tiny muted" style={{ marginBottom: 5 }}>
        MOTIVO (obligatorio)
      </div>
      <input
        className="input"
        style={{ width: "100%", marginBottom: 16 }}
        placeholder="Ej: caja dañada en el traslado"
        value={motivo}
        onChange={(ev) => setMotivo(ev.target.value)}
      />

      <div className="row" style={{ gap: 10 }}>
        <button
          className="btn btn-danger grow"
          style={{ padding: 11 }}
          disabled={!por.trim() || !motivo.trim() || enviando}
          onClick={confirmar}
        >
          <Trash2 size={15} /> {enviando ? "Anulando..." : "Anular caja"}
        </button>
        <button className="btn btn-ghost" style={{ padding: "11px 16px" }} onClick={onCerrar}>
          Cancelar
        </button>
      </div>
    </Modal>
  );
}
