"use client";

import { useState } from "react";
import { AlertTriangle, Factory, Lock, Package, Plus, Trash2, Users, Clock, Check } from "lucide-react";
import { api, fechaHora, type Catalogos } from "@/lib/cliente";
import { Aviso } from "./ui";

type Pestana = "maquinas" | "frascos" | "operarios" | "turnos" | "pins";

export function ConfigView({ cat, recargar }: { cat: Catalogos; recargar: () => Promise<void> }) {
  const [tab, setTab] = useState<Pestana>("maquinas");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  /** Envuelve una acción: muestra el error o el mensaje de éxito y recarga. */
  async function accion(fn: () => Promise<unknown>, mensaje: string) {
    setError(null);
    setOk(null);
    try {
      await fn();
      setOk(mensaje);
      await recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la acción.");
    }
  }

  // Cuantos roles siguen con el PIN de fabrica. Se muestra en la pestana para
  // que se vea sin tener que entrar a buscarlo.
  const deFabrica = cat.pinsPorDefecto.length;

  const tabs: { id: Pestana; rotulo: string; icono: React.ReactNode }[] = [
    { id: "maquinas", rotulo: "Máquinas", icono: <Factory size={15} /> },
    { id: "frascos", rotulo: "Frascos", icono: <Package size={15} /> },
    { id: "operarios", rotulo: "Operarios", icono: <Users size={15} /> },
    { id: "turnos", rotulo: "Turnos", icono: <Clock size={15} /> },
    {
      id: "pins",
      rotulo: deFabrica > 0 ? `PINs (${deFabrica} sin cambiar)` : "PINs",
      icono: deFabrica > 0 ? <AlertTriangle size={15} /> : <Lock size={15} />,
    },
  ];

  return (
    <div>
      <div className="row wrap" style={{ gap: 6, marginBottom: 18 }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`tab-btn ${tab === t.id ? "active" : ""}`}
            onClick={() => {
              setTab(t.id);
              setError(null);
              setOk(null);
            }}
          >
            {t.icono} {t.rotulo}
          </button>
        ))}
      </div>

      {error && <Aviso onCerrar={() => setError(null)}>{error}</Aviso>}
      {ok && (
        <Aviso tipo="ok" onCerrar={() => setOk(null)}>
          {ok}
        </Aviso>
      )}

      {tab === "maquinas" && <Maquinas cat={cat} accion={accion} />}
      {tab === "frascos" && <Frascos cat={cat} accion={accion} />}
      {tab === "operarios" && <Operarios cat={cat} accion={accion} />}
      {tab === "turnos" && <Turnos cat={cat} accion={accion} />}
      {tab === "pins" && <Pins cat={cat} accion={accion} />}
    </div>
  );
}

type Accion = (fn: () => Promise<unknown>, mensaje: string) => Promise<void>;

// ---------------------------------------------------------------------------
function Maquinas({ cat, accion }: { cat: Catalogos; accion: Accion }) {
  const [nombre, setNombre] = useState("");
  const [frascoId, setFrascoId] = useState("");

  return (
    <div>
      <div className="card" style={{ padding: 18, marginBottom: 18 }}>
        <div className="font-display" style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>
          Agregar máquina
        </div>
        <div className="small muted" style={{ marginBottom: 14 }}>
          El producto que elijas acá es el inicial. Después lo cambia el jefe de planta al abrir un
          lote de otro producto.
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <input
            className="input"
            style={{ minWidth: 200 }}
            placeholder="Nombre (ej. Sopladora 3)"
            value={nombre}
            onChange={(ev) => setNombre(ev.target.value)}
          />
          <select className="input" value={frascoId} onChange={(ev) => setFrascoId(ev.target.value)}>
            <option value="">Elegí el producto...</option>
            {cat.frascos.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nombre}
              </option>
            ))}
          </select>
          <button
            className="btn btn-amber"
            disabled={!nombre.trim() || !frascoId}
            onClick={() =>
              accion(
                () => api.post("/api/catalogos/maquinas", { nombre, frascoId: Number(frascoId) }),
                `Máquina "${nombre}" creada. Ya se le puede abrir un lote desde la pestaña Lotes.`
              ).then(() => {
                setNombre("");
                setFrascoId("");
              })
            }
          >
            <Plus size={15} /> Agregar
          </button>
        </div>
      </div>

      <div className="card" style={{ overflow: "auto" }}>
        <table className="hist">
          <thead>
            <tr>
              <th>Máquina</th>
              <th>Produce</th>
              <th>Lote abierto</th>
              <th className="num">Próx. caja</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cat.maquinas.map((m) => (
              <tr key={m.id}>
                <td style={{ fontWeight: 600 }}>{m.nombre}</td>
                <td className="muted">{m.frascoNombre ?? "—"}</td>
                <td>
                  {m.loteCodigo ? (
                    <span className="chip chip-amber font-mono">{m.loteCodigo}</span>
                  ) : (
                    <span className="chip chip-danger">Sin lote</span>
                  )}
                </td>
                <td className="num">{m.proximaCaja ?? "—"}</td>
                <td className="small muted">
                  {m.loteId && m.limite !== null
                    ? `${m.porcentaje}% del límite${m.enCola > 0 ? ` · ${m.enCola} en cola` : ""}`
                    : "parada"}
                </td>
                <td>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: "4px 8px" }}
                    title="Desactivar máquina"
                    onClick={() =>
                      accion(
                        () => api.del("/api/catalogos/maquinas", { id: m.id }),
                        `${m.nombre} desactivada.`
                      )
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="tiny muted" style={{ marginTop: 12, lineHeight: 1.6, maxWidth: 700 }}>
        Los lotes se abren desde la pestaña <b style={{ color: "var(--text)" }}>Lotes</b>, no desde
        acá: eso lo maneja el jefe de planta, que es quien define el límite de cada lote.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Frascos({ cat, accion }: { cat: Catalogos; accion: Accion }) {
  const [nombre, setNombre] = useState("");
  const [cant, setCant] = useState("");

  return (
    <div>
      <div className="card" style={{ padding: 18, marginBottom: 18 }}>
        <div className="font-display" style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>
          Agregar frasco
        </div>
        <div className="small muted" style={{ marginBottom: 14 }}>
          La cantidad estándar se completa sola al etiquetar, así el operario no tiene que tipearla.
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <input
            className="input"
            style={{ minWidth: 220 }}
            placeholder="Nombre / modelo"
            value={nombre}
            onChange={(ev) => setNombre(ev.target.value)}
          />
          <input
            className="input"
            style={{ width: 170 }}
            type="number"
            min={1}
            placeholder="Unidades por caja"
            value={cant}
            onChange={(ev) => setCant(ev.target.value)}
          />
          <button
            className="btn btn-amber"
            disabled={!nombre.trim()}
            onClick={() =>
              accion(
                () =>
                  api.post("/api/catalogos/frascos", {
                    nombre,
                    cantidadEstandar: cant ? Number(cant) : null,
                  }),
                `Frasco "${nombre}" creado.`
              ).then(() => {
                setNombre("");
                setCant("");
              })
            }
          >
            <Plus size={15} /> Agregar
          </button>
        </div>
      </div>

      <div className="card" style={{ overflow: "auto" }}>
        <table className="hist">
          <thead>
            <tr>
              <th>Frasco</th>
              <th className="num">Cantidad estándar</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cat.frascos.map((f) => (
              <FilaFrasco key={f.id} f={f} accion={accion} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilaFrasco({
  f,
  accion,
}: {
  f: { id: number; nombre: string; cantidadEstandar: number | null };
  accion: Accion;
}) {
  const [valor, setValor] = useState(f.cantidadEstandar?.toString() ?? "");
  const cambio = valor !== (f.cantidadEstandar?.toString() ?? "");

  return (
    <tr>
      <td style={{ fontWeight: 600 }}>{f.nombre}</td>
      <td className="num">
        <input
          className="input font-mono"
          style={{ width: 100, padding: "6px 10px", textAlign: "right" }}
          type="number"
          min={1}
          value={valor}
          onChange={(ev) => setValor(ev.target.value)}
        />
      </td>
      <td>
        {cambio && (
          <button
            className="btn btn-amber small"
            onClick={() =>
              accion(
                () =>
                  api.patch("/api/catalogos/frascos", {
                    id: f.id,
                    cantidadEstandar: valor ? Number(valor) : null,
                  }),
                `Cantidad estándar de "${f.nombre}" actualizada.`
              )
            }
          >
            <Check size={13} /> Guardar
          </button>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
function Operarios({ cat, accion }: { cat: Catalogos; accion: Accion }) {
  const [nombre, setNombre] = useState("");

  return (
    <div>
      <div className="card" style={{ padding: 18, marginBottom: 18 }}>
        <div className="row wrap" style={{ gap: 10 }}>
          <input
            className="input"
            style={{ minWidth: 240 }}
            placeholder="Nombre y apellido del operario"
            value={nombre}
            onChange={(ev) => setNombre(ev.target.value)}
          />
          <button
            className="btn btn-amber"
            disabled={!nombre.trim()}
            onClick={() =>
              accion(
                () => api.post("/api/catalogos/operarios", { nombre }),
                `Operario "${nombre}" agregado.`
              ).then(() => setNombre(""))
            }
          >
            <Plus size={15} /> Agregar
          </button>
        </div>
      </div>

      <div className="card" style={{ overflow: "auto" }}>
        <table className="hist">
          <thead>
            <tr>
              <th>Operario</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cat.operarios.map((o) => (
              <tr key={o.id}>
                <td style={{ fontWeight: 600 }}>{o.nombre}</td>
                <td>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: "4px 8px" }}
                    title="Dar de baja"
                    onClick={() =>
                      accion(async () => {
                        const r = await api.del<{ accion: string; etiquetas: number }>(
                          "/api/catalogos/operarios",
                          { id: o.id }
                        );
                        return r;
                      }, `${o.nombre} dado de baja.`)
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="tiny muted" style={{ marginTop: 12, lineHeight: 1.6, maxWidth: 700 }}>
        Si el operario ya produjo cajas no se borra: se desactiva y sale de la pantalla de
        etiquetado, pero su historial queda intacto. Borrarlo rompería la trazabilidad de esas cajas.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Turnos({ cat, accion }: { cat: Catalogos; accion: Accion }) {
  const [nombre, setNombre] = useState("");

  return (
    <div>
      <div className="card" style={{ padding: 18, marginBottom: 18 }}>
        <div className="row wrap" style={{ gap: 10 }}>
          <input
            className="input"
            style={{ minWidth: 200 }}
            placeholder="Nombre del turno"
            value={nombre}
            onChange={(ev) => setNombre(ev.target.value)}
          />
          <button
            className="btn btn-amber"
            disabled={!nombre.trim()}
            onClick={() =>
              accion(
                () => api.post("/api/catalogos/turnos", { nombre }),
                `Turno "${nombre}" agregado.`
              ).then(() => setNombre(""))
            }
          >
            <Plus size={15} /> Agregar
          </button>
        </div>
      </div>

      <div className="card" style={{ overflow: "auto" }}>
        <table className="hist">
          <tbody>
            {cat.turnos.map((t) => (
              <tr key={t.id}>
                <td style={{ fontWeight: 600 }}>{t.nombre}</td>
                <td style={{ width: 60 }}>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: "4px 8px" }}
                    onClick={() =>
                      accion(
                        () => api.del("/api/catalogos/turnos", { id: t.id }),
                        `Turno "${t.nombre}" dado de baja.`
                      )
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Pins({ cat, accion }: { cat: Catalogos; accion: Accion }) {
  const [cual, setCual] = useState<"jefe" | "calidad" | "admin">("jefe");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");

  const valido = /^\d{4,8}$/.test(pin) && pin === pin2;

  const ROTULO = { jefe: "Jefe de planta", calidad: "Calidad", admin: "Administración" };
  const deFabrica = cat.pinsPorDefecto;

  return (
    <div style={{ maxWidth: 460 }}>
      {deFabrica.length > 0 && (
        <Aviso tipo="error">
          <strong>
            {deFabrica.length === 1
              ? "Un rol sigue con el PIN de fábrica"
              : `${deFabrica.length} roles siguen con el PIN de fábrica`}
            : {deFabrica.map((r) => ROTULO[r]).join(", ")}.
          </strong>{" "}
          Los PINs iniciales están escritos en la documentación del sistema, así que
          cualquiera que la haya visto los conoce. Cambialos antes de usar esto en
          producción. Conviene que sean de 6 dígitos: uno de 4 son 10.000
          combinaciones y la app es alcanzable desde internet.
        </Aviso>
      )}
      <div className="card" style={{ padding: 20 }}>
        <div className="font-display" style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>
          Cambiar PIN
        </div>
        <div className="small muted" style={{ marginBottom: 18, lineHeight: 1.5 }}>
          Los PINs se guardan hasheados y se validan en el servidor: nunca bajan al navegador.
        </div>

        <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
          {(
            [
              { id: "jefe", rotulo: "Jefe de planta" },
              { id: "calidad", rotulo: "Calidad" },
              { id: "admin", rotulo: "Administración" },
            ] as const
          ).map((r) => (
            <button
              key={r.id}
              className={`btn ${cual === r.id ? "btn-amber" : "btn-ghost"} small`}
              onClick={() => setCual(r.id)}
            >
              {r.rotulo}
            </button>
          ))}
        </div>

        <div className="tiny muted" style={{ marginBottom: 14, lineHeight: 1.6 }}>
          <b style={{ color: "var(--text)" }}>Jefe de planta</b> abre y cierra lotes.{" "}
          <b style={{ color: "var(--text)" }}>Calidad</b> libera y rechaza cajas.{" "}
          <b style={{ color: "var(--text)" }}>Administración</b> hace todo, incluido configurar esto.
          Los tres PINs tienen que ser distintos.
        </div>

        <div className="tiny muted" style={{ marginBottom: 5 }}>
          NUEVO PIN (4 a 8 dígitos)
        </div>
        <input
          className="input font-mono"
          style={{ width: "100%", marginBottom: 10, letterSpacing: ".3em" }}
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(ev) => setPin(ev.target.value.replace(/\D/g, "").slice(0, 8))}
        />

        <div className="tiny muted" style={{ marginBottom: 5 }}>
          REPETIR
        </div>
        <input
          className="input font-mono"
          style={{ width: "100%", marginBottom: 6, letterSpacing: ".3em" }}
          type="password"
          inputMode="numeric"
          value={pin2}
          onChange={(ev) => setPin2(ev.target.value.replace(/\D/g, "").slice(0, 8))}
        />

        <div className="tiny" style={{ minHeight: 18, color: "var(--danger)", marginBottom: 10 }}>
          {pin && pin.length < 4
            ? "Mínimo 4 dígitos."
            : pin2 && pin !== pin2
              ? "Los dos PINs no coinciden."
              : ""}
        </div>

        <button
          className="btn btn-amber"
          style={{ width: "100%", padding: 11 }}
          disabled={!valido}
          onClick={() =>
            accion(
              () => api.post("/api/config/pin", { rol: cual, pin }),
              `PIN de ${
                cual === "admin" ? "administración" : cual === "jefe" ? "jefe de planta" : "calidad"
              } cambiado.`
            ).then(() => {
              setPin("");
              setPin2("");
            })
          }
        >
          <Lock size={15} /> Cambiar PIN
        </button>
      </div>
    </div>
  );
}
