"use client";

/**
 * Cliente de la API. Todo el fetch de la UI pasa por aca, para que el manejo de
 * errores sea uno solo: el backend responde {ok:false,error:"..."} y esto lo
 * convierte en una excepcion con el mensaje ya listo para mostrar.
 */

export class ErrorApi extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "ErrorApi";
  }
}

async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(ruta, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    // Sin red: en planta esto pasa si el servidor se reinicia.
    throw new ErrorApi("Sin conexión con el servidor. Reintentá en unos segundos.", 0);
  }

  let j: { ok?: boolean; data?: T; error?: string };
  try {
    j = await r.json();
  } catch {
    throw new ErrorApi(`El servidor respondió algo inesperado (HTTP ${r.status}).`, r.status);
  }

  if (!r.ok || j.ok === false) {
    throw new ErrorApi(j.error ?? `Error ${r.status}`, r.status);
  }
  return j.data as T;
}

export const api = {
  get: <T>(ruta: string) => pedir<T>(ruta),
  post: <T>(ruta: string, cuerpo?: unknown) =>
    pedir<T>(ruta, { method: "POST", body: JSON.stringify(cuerpo ?? {}) }),
  patch: <T>(ruta: string, cuerpo: unknown) =>
    pedir<T>(ruta, { method: "PATCH", body: JSON.stringify(cuerpo) }),
  del: <T>(ruta: string, cuerpo: unknown) =>
    pedir<T>(ruta, { method: "DELETE", body: JSON.stringify(cuerpo) }),
};

/** Arma un querystring salteando los vacios. */
export function qs(o: Record<string, string | number | undefined | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

// ---------------------------------------------------------------------------
// Tipos compartidos con el backend
// ---------------------------------------------------------------------------

export type Rol = "operario" | "jefe" | "calidad" | "admin";

export type Permiso = "etiquetar" | "ver" | "lotes" | "calidad" | "anular" | "config";

export const ETIQUETA_ROL: Record<Rol, string> = {
  operario: "Operario",
  jefe: "Jefe de planta",
  calidad: "Calidad",
  admin: "Administración",
};

/** Info del lote que devuelve el POST de una etiqueta, para avisar al operario. */
export type LoteTrasEtiqueta = {
  codigo: string;
  limite: number;
  limiteUnidad: string;
  hecho: number;
  /** Código del lote que se cerró con esta caja, o null. */
  cerrado: string | null;
  /** Código del lote que arrancó en su lugar, o null si la cola estaba vacía. */
  siguiente: string | null;
};

export type Etiqueta = {
  id: number;
  loteId: number;
  caja: number;
  cantidad: number;
  operarioId: number;
  loteCodigo: string;
  maquinaNombre: string;
  frascoNombre: string;
  operarioNombre: string;
  turno: string;
  creadoEn: string;
  estadoCalidad: "pendiente" | "liberada" | "rechazada";
  calidadPor: string | null;
  calidadEn: string | null;
  calidadNota: string | null;
  anulada: boolean;
  anuladaPor: string | null;
  anuladaEn: string | null;
  anuladaMotivo: string | null;
  impresiones: number;
  ultimaImpresionEn: string | null;
  /** Solo viene en la respuesta de crear. */
  lote?: LoteTrasEtiqueta;
};

export type Unidad = "cajas" | "unidades";

export type MaquinaCat = {
  id: number;
  nombre: string;
  activa: boolean;
  frascoId: number | null;
  frascoNombre: string | null;
  cantidadEstandar: number | null;
  loteId: number | null;
  loteNumero: number | null;
  loteCodigo: string | null;
  loteAbiertoEn: string | null;
  limite: number | null;
  limiteUnidad: string | null;
  proximaCaja: number | null;
  progresoCajas: number;
  progresoUnidades: number;
  /** Lo hecho en la unidad del límite. */
  hecho: number;
  restante: number;
  porcentaje: number;
  /** Cuántos lotes preparados esperan en esta máquina. */
  enCola: number;
};

export type LoteFila = {
  id: number;
  numero: number;
  codigo: string;
  maquinaId: number;
  frascoId: number;
  maquinaNombre: string;
  frascoNombre: string;
  limite: number;
  limiteUnidad: string;
  estado: "preparado" | "abierto" | "cerrado";
  preparadoPor: string | null;
  preparadoEn: string;
  abiertoEn: string | null;
  cerradoEn: string | null;
  cerradoMotivo: string | null;
  cerradoPor: string | null;
  nota: string | null;
  progresoCajas: number;
  progresoUnidades: number;
  hecho: number;
  porcentaje: number;
  restante: number;
  excedente: number;
};

export type Catalogos = {
  rol: Rol;
  /** true si el server corre con MODO_DEMO=1: la app muestra el banner de prueba. */
  modoDemo: boolean;
  permisos: Permiso[];
  pins: { jefe: boolean; calidad: boolean; admin: boolean };
  maquinas: MaquinaCat[];
  operarios: { id: number; nombre: string }[];
  turnos: { id: number; nombre: string }[];
  frascos: {
    id: number;
    nombre: string;
    cantidadEstandar: number | null;
    prefijoLote: string | null;
  }[];
  pendientesCalidad: number;
  /** Máquinas paradas por falta de lote. */
  sinLote: number;
};

export type FilaMetrica = {
  clave: string;
  cajas: number;
  unidades: number;
  liberadas: number;
  pendientes: number;
  rechazadas: number;
  anuladas: number;
  primera: string | null;
  ultima: string | null;
  dias: number;
  minutosActivos: number;
  cajasPorHora: number | null;
  cajasPorDia: number | null;
  tasaRechazo: number | null;
};

export type Metricas = {
  dimension: string;
  dimensionesDisponibles: string[];
  totales: {
    cajas: number;
    unidades: number;
    liberadas: number;
    pendientes: number;
    rechazadas: number;
    anuladas: number;
    operarios: number;
    lotes: number;
    dias: number;
  };
  filas: FilaMetrica[];
  serie?: FilaMetrica[];
};

// ---------------------------------------------------------------------------
// Formateo (hora local del navegador, que en la planta es la hora de la planta)
// ---------------------------------------------------------------------------

export function fechaHora(iso: string | null): { fecha: string; hora: string } {
  if (!iso) return { fecha: "", hora: "" };
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    // dd/mm/aaaa con ceros: en una etiqueta impresa "20/8" se lee peor que "20/08".
    fecha: `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`,
    // 24 horas. En planta "09:42 a. m." no sirve: el turno noche cruza el mediodía
    // y el "a. m./p. m." es una fuente de confusión gratuita.
    hora: `${p(d.getHours())}:${p(d.getMinutes())}`,
  };
}

export function num(n: number) {
  return n.toLocaleString("es-AR");
}

/** "1 caja" / "30 cajas". Evita el clasico "Faltan 1 cajas". */
export function plural(n: number, singular: string, pluralForma?: string) {
  return `${num(n)} ${n === 1 ? singular : (pluralForma ?? singular + "s")}`;
}

/** Concuerda el verbo con el numero: "Falta 1 caja" / "Faltan 30 cajas". */
export function faltan(n: number, unidad: "cajas" | "unidades") {
  const verbo = n === 1 ? "Falta" : "Faltan";
  const cosa = unidad === "cajas" ? plural(n, "caja") : plural(n, "unidad", "unidades");
  return `${verbo} ${cosa}`;
}

/** "2026-08-20" -> "20/08" para los ejes del gráfico. */
export function diaCorto(clave: string) {
  const [, m, d] = clave.split("-");
  return d && m ? `${d}/${m}` : clave;
}

/** Fecha de hoy en formato YYYY-MM-DD, en hora local. */
export function hoyISO(offsetDias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDias);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
