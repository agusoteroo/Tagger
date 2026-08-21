"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart3, Download, Eye, FileText, TrendingUp } from "lucide-react";
import {
  api,
  diaCorto,
  hoyISO,
  num,
  qs,
  type Catalogos,
  type FilaMetrica,
  type Metricas,
} from "@/lib/cliente";
import { Aviso, Cargando, EstadoVacio, Tarjeta } from "./ui";

/**
 * Tablero de eficiencia. Esta pantalla no existía en el artifact original.
 *
 * Cruza cualquier dimensión (operario, turno, máquina, frasco, día, lote) con
 * cualquier filtro, sobre un rango de fechas. Es lo que hace falta para
 * responder "¿cuánto produjo cada uno?" en vez de mirar una lista de filas.
 */

const DIMS: { valor: string; rotulo: string }[] = [
  { valor: "operario", rotulo: "Operario" },
  { valor: "turno", rotulo: "Turno" },
  { valor: "maquina", rotulo: "Máquina" },
  { valor: "frasco", rotulo: "Frasco" },
  { valor: "dia", rotulo: "Día" },
  { valor: "lote", rotulo: "Lote" },
];

export function MetricasView({ cat }: { cat: Catalogos }) {
  const [dim, setDim] = useState("operario");
  const [desde, setDesde] = useState(hoyISO(-29));
  const [hasta, setHasta] = useState(hoyISO());
  const [operarioId, setOperarioId] = useState("");
  const [maquina, setMaquina] = useState("");
  const [turno, setTurno] = useState("");
  const [frasco, setFrasco] = useState("");
  const [datos, setDatos] = useState<Metricas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const consulta = qs({ dim, desde, hasta, operarioId, maquina, turno, frasco });

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setDatos(await api.get<Metricas>(`/api/metricas${consulta}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las métricas.");
    } finally {
      setCargando(false);
    }
  }, [consulta]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const t = datos?.totales;
  const rotuloDim = DIMS.find((d) => d.valor === dim)?.rotulo ?? dim;
  const maxUnidades = Math.max(1, ...(datos?.filas ?? []).map((f) => f.unidades));

  return (
    <div>
      {error && <Aviso onCerrar={() => setError(null)}>{error}</Aviso>}

      {/* --- Controles --- */}
      <div className="row wrap" style={{ gap: 10, marginBottom: 14 }}>
        <div className="row" style={{ gap: 6 }}>
          <BarChart3 size={16} style={{ color: "var(--amber)" }} />
          <span className="tiny muted">AGRUPAR POR</span>
        </div>
        {DIMS.map((d) => (
          <button
            key={d.valor}
            className={`btn ${dim === d.valor ? "btn-amber" : "btn-ghost"} small`}
            onClick={() => setDim(d.valor)}
          >
            {d.rotulo}
          </button>
        ))}
      </div>

      <div className="row wrap" style={{ gap: 10, marginBottom: 18 }}>
        <span className="tiny muted">DESDE</span>
        <input
          className="input"
          type="date"
          value={desde}
          max={hasta}
          onChange={(ev) => setDesde(ev.target.value)}
        />
        <span className="tiny muted">HASTA</span>
        <input
          className="input"
          type="date"
          value={hasta}
          min={desde}
          onChange={(ev) => setHasta(ev.target.value)}
        />
        <button
          className="btn btn-ghost small"
          onClick={() => {
            setDesde(hoyISO());
            setHasta(hoyISO());
          }}
        >
          Hoy
        </button>
        <button
          className="btn btn-ghost small"
          onClick={() => {
            setDesde(hoyISO(-6));
            setHasta(hoyISO());
          }}
        >
          7 días
        </button>
        <button
          className="btn btn-ghost small"
          onClick={() => {
            setDesde(hoyISO(-29));
            setHasta(hoyISO());
          }}
        >
          30 días
        </button>

        <select className="input" value={operarioId} onChange={(ev) => setOperarioId(ev.target.value)}>
          <option value="">Todos los operarios</option>
          {cat.operarios.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nombre}
            </option>
          ))}
        </select>
        <select className="input" value={maquina} onChange={(ev) => setMaquina(ev.target.value)}>
          <option value="">Todas las máquinas</option>
          {cat.maquinas.map((m) => (
            <option key={m.id} value={m.nombre}>
              {m.nombre}
            </option>
          ))}
        </select>
        <select className="input" value={turno} onChange={(ev) => setTurno(ev.target.value)}>
          <option value="">Todos los turnos</option>
          {cat.turnos.map((tt) => (
            <option key={tt.id} value={tt.nombre}>
              {tt.nombre}
            </option>
          ))}
        </select>
        <select className="input" value={frasco} onChange={(ev) => setFrasco(ev.target.value)}>
          <option value="">Todos los productos</option>
          {cat.frascos.map((fr) => (
            <option key={fr.id} value={fr.nombre}>
              {fr.nombre}
            </option>
          ))}
        </select>
        {(operarioId || maquina || turno || frasco) && (
          <button
            className="btn btn-ghost small"
            onClick={() => {
              setOperarioId("");
              setMaquina("");
              setTurno("");
              setFrasco("");
            }}
          >
            Limpiar filtros
          </button>
        )}

        <div className="row ml-auto" style={{ gap: 8 }}>
          <a className="btn btn-ghost small" href={`/api/export${consulta}`}>
            <Download size={14} /> Exportar CSV
          </a>
          {/* El reporte respeta los MISMOS filtros que la pantalla, así lo que
              recibe el cliente coincide con lo que se está viendo acá. */}
          <a
            className="btn btn-ghost small"
            href={`/api/reporte${consulta}${consulta ? "&" : "?"}ver=1`}
            target="_blank"
            rel="noreferrer"
            title="Ver el reporte antes de mandarlo"
          >
            <Eye size={14} /> Ver
          </a>
          <a
            className="btn btn-amber small"
            href={`/api/reporte${consulta}`}
            title="Baja un archivo HTML que se abre en cualquier lado, sin internet"
          >
            <FileText size={14} /> Generar reporte
          </a>
        </div>
      </div>

      {cargando && !datos ? (
        <Cargando texto="Calculando..." />
      ) : t && t.cajas === 0 ? (
        <EstadoVacio
          icon={<BarChart3 size={26} />}
          titulo="No hay producción en ese rango"
          texto="Probá ampliar las fechas o quitar algún filtro."
        />
      ) : (
        <>
          {/* --- Totales --- */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 12,
              marginBottom: 20,
            }}
          >
            <Tarjeta rotulo="Cajas" valor={num(t!.cajas)} color="var(--amber)" sub={`${t!.dias} días con producción`} />
            <Tarjeta rotulo="Unidades" valor={num(t!.unidades)} />
            <Tarjeta
              rotulo="Liberadas"
              valor={num(t!.liberadas)}
              color="var(--success)"
              sub={t!.cajas ? `${Math.round((t!.liberadas / t!.cajas) * 100)}% del total` : undefined}
            />
            <Tarjeta
              rotulo="Pendientes"
              valor={num(t!.pendientes)}
              color={t!.pendientes ? "var(--danger)" : undefined}
            />
            <Tarjeta
              rotulo="Rechazadas"
              valor={num(t!.rechazadas)}
              color={t!.rechazadas ? "var(--danger)" : undefined}
              sub={
                t!.liberadas + t!.rechazadas
                  ? `${(Math.round((t!.rechazadas / (t!.liberadas + t!.rechazadas)) * 1000) / 10)
                      .toString()
                      .replace(".", ",")}% de rechazo`
                  : undefined
              }
            />
            <Tarjeta rotulo="Anuladas" valor={num(t!.anuladas)} sub="no cuentan como producción" />
          </div>

          {/* --- Tendencia --- */}
          {datos?.serie && datos.serie.length > 1 && (
            <div className="card" style={{ padding: 18, marginBottom: 20 }}>
              <div className="row" style={{ gap: 6, marginBottom: 14 }}>
                <TrendingUp size={15} style={{ color: "var(--steel)" }} />
                <span className="font-display" style={{ fontWeight: 600, fontSize: 16 }}>
                  Cajas por día
                </span>
              </div>
              <Grafico serie={datos.serie} />
            </div>
          )}

          {/* --- Tabla por dimensión --- */}
          <div className="card" style={{ overflow: "auto" }}>
            <table className="hist">
              <thead>
                <tr>
                  <th>{rotuloDim}</th>
                  <th className="num">Cajas</th>
                  <th className="num">Unidades</th>
                  <th style={{ width: 120 }}>Participación</th>
                  <th className="num">Días</th>
                  <th className="num" title="Suma de los lapsos de cada día, no el rango completo">
                    Hs trab.
                  </th>
                  <th className="num" title="Cajas por hora trabajada">
                    Cajas/h
                  </th>
                  <th className="num">Cajas/día</th>
                  <th className="num">Liberadas</th>
                  <th className="num">Pend.</th>
                  <th className="num" title="% de rechazo sobre las cajas ya dictaminadas">
                    % Rech.
                  </th>
                </tr>
              </thead>
              <tbody>
                {datos?.filas.map((r) => (
                  <tr key={r.clave}>
                    <td style={{ fontWeight: 600 }}>{dim === "dia" ? diaCorto(r.clave) : r.clave}</td>
                    <td className="num">{num(r.cajas)}</td>
                    <td className="num">{num(r.unidades)}</td>
                    <td>
                      <div className="barra" title={`${Math.round((r.unidades / maxUnidades) * 100)}%`}>
                        <span style={{ width: `${(r.unidades / maxUnidades) * 100}%` }} />
                      </div>
                    </td>
                    <td className="num">{r.dias}</td>
                    <td className="num">{(r.minutosActivos / 60).toFixed(1)}</td>
                    <td className="num" style={{ color: "var(--amber)", fontWeight: 700 }}>
                      {r.cajasPorHora ?? "—"}
                    </td>
                    <td className="num">{r.cajasPorDia ?? "—"}</td>
                    <td className="num" style={{ color: "var(--success)" }}>
                      {num(r.liberadas)}
                    </td>
                    <td className="num">{num(r.pendientes)}</td>
                    <td
                      className="num"
                      style={{
                        color:
                          r.tasaRechazo === null
                            ? undefined
                            : r.tasaRechazo >= 5
                              ? "var(--danger)"
                              : "var(--muted)",
                        fontWeight: r.tasaRechazo !== null && r.tasaRechazo >= 5 ? 700 : 400,
                      }}
                    >
                      {r.tasaRechazo === null ? "—" : `${String(r.tasaRechazo).replace(".", ",")}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div
            className="card tiny"
            style={{
              marginTop: 16,
              padding: "14px 16px",
              lineHeight: 1.6,
              maxWidth: 720,
              borderLeftColor: "var(--amber)",
              borderLeftWidth: 3,
            }}
          >
            <b style={{ color: "var(--amber)" }}>Generar reporte</b> baja un archivo HTML con todo
            lo que estás viendo acá, <b>respetando los filtros puestos</b> (fechas, operario,
            máquina, turno y producto). Si hay algún filtro activo, el reporte lo aclara arriba en
            un recuadro para que nadie lea los totales como si fueran de toda la planta. Es un solo archivo sin
            dependencias: se manda por mail o WhatsApp y el cliente lo abre en la computadora o en
            el celular, <b>sin internet y sin que la PC de la planta tenga que estar prendida</b>.
            Es una foto del momento, así que lleva la fecha de generación bien visible.
          </div>

          <div className="tiny muted" style={{ marginTop: 12, lineHeight: 1.6, maxWidth: 720 }}>
            <b>Cómo leer &quot;Hs trab.&quot; y &quot;Cajas/h&quot;:</b> las horas trabajadas se
            calculan sumando, día por día, el lapso entre la primera y la última caja de ese grupo.
            No es el rango completo (eso incluiría noches y fines de semana y daría un ritmo falso).
            Sigue siendo una aproximación: no ve el tiempo antes de la primera caja ni después de la
            última, y sí cuenta las pausas del medio. Sirve para comparar entre operarios en
            condiciones parecidas, no como medida absoluta de productividad.
          </div>
        </>
      )}
    </div>
  );
}

/** Gráfico de barras en SVG. Sin librerías: son pocos datos. */
function Grafico({ serie }: { serie: FilaMetrica[] }) {
  const max = Math.max(1, ...serie.map((s) => s.cajas));
  const alto = 120;
  const anchoBarra = 100 / serie.length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", height: alto, gap: 2 }}>
        {serie.map((s) => {
          const h = (s.cajas / max) * 100;
          return (
            <div
              key={s.clave}
              title={`${diaCorto(s.clave)}: ${s.cajas} cajas · ${num(s.unidades)} unidades`}
              style={{
                flex: 1,
                height: `${Math.max(h, 1.5)}%`,
                background: s.rechazadas > 0 ? "var(--steel)" : "var(--amber)",
                borderRadius: "3px 3px 0 0",
                minWidth: 3,
                transition: "height .2s ease",
              }}
            />
          );
        })}
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
        <span className="tiny muted font-mono">{diaCorto(serie[0].clave)}</span>
        <span className="tiny muted">
          máx {max} cajas/día {anchoBarra < 3 ? "" : ""}
        </span>
        <span className="tiny muted font-mono">{diaCorto(serie[serie.length - 1].clave)}</span>
      </div>
    </div>
  );
}
