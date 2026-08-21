import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/**
 * Esquema en PostgreSQL (Supabase).
 *
 * Dos cambios respecto de la version en SQLite que valen la pena:
 *
 * 1. Las marcas de tiempo son `timestamptz` de verdad, no texto ISO. Eso
 *    habilita las funciones de fecha nativas de Postgres y, sobre todo,
 *    `AT TIME ZONE 'America/Argentina/Buenos_Aires'`, que maneja bien el
 *    horario de verano si algun dia vuelve. Antes era un offset fijo de -3.
 *
 * 2. `mode: "string"` para que sigan viajando como ISO al frontend, asi la UI,
 *    los reportes y el export no cambian nada.
 */

/** Marca de tiempo del servidor de base, no del cliente. */
const AHORA = sql`now()`;

const ts = (nombre: string) => timestamp(nombre, { withTimezone: true, mode: "string" });

// ---------------------------------------------------------------------------
// Catalogos
// ---------------------------------------------------------------------------

export const frascos = pgTable("frascos", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull().unique(),
  cantidadEstandar: integer("cantidad_estandar"),
  /**
   * Prefijo opcional para el codigo de lote de este producto.
   * La numeracion de lotes es POR FRASCO, asi que el lote 100 del 100ml y el
   * lote 100 del 500ml existen los dos. En la etiqueta impresa eso seria
   * ambiguo si solo dijera "100", por eso se puede prefijar: "F100-100".
   */
  prefijoLote: text("prefijo_lote"),
  activo: boolean("activo").notNull().default(true),
  creadoEn: ts("creado_en").notNull().default(AHORA),
});

export const operarios = pgTable("operarios", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull().unique(),
  activo: boolean("activo").notNull().default(true),
  creadoEn: ts("creado_en").notNull().default(AHORA),
});

export const turnos = pgTable("turnos", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull().unique(),
  orden: integer("orden").notNull().default(0),
  activo: boolean("activo").notNull().default(true),
});

export const maquinas = pgTable("maquinas", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull().unique(),
  // Que produce hoy. Cambia cuando el jefe abre un lote de otro producto.
  frascoId: integer("frasco_id").references(() => frascos.id),
  // Lote en curso (estado 'abierto'). null = maquina sin lote, no puede etiquetar.
  loteActualId: integer("lote_actual_id"),
  activa: boolean("activa").notNull().default(true),
  creadoEn: ts("creado_en").notNull().default(AHORA),
});

// ---------------------------------------------------------------------------
// Lotes
//
// Ciclo de vida:  preparado -> abierto -> cerrado
//
//   preparado : el jefe lo cargo pero todavia no arranco. Ya tiene numero
//               reservado. Es la cola: cuando el lote abierto se completa,
//               el mas viejo de los preparados de esa maquina arranca solo,
//               asi la linea no se detiene esperando al jefe.
//   abierto   : es el que esta produciendo. Uno solo por maquina.
//   cerrado   : llego al limite, o lo cerro alguien a mano.
//
// El numero es secuencial POR FRASCO y se reserva al crear el lote (no al
// activarlo), asi dos maquinas que hacen el mismo producto nunca colisionan.
// ---------------------------------------------------------------------------

export const lotes = pgTable(
  "lotes",
  {
    id: serial("id").primaryKey(),

    /** Numero secuencial dentro de la secuencia del frasco. */
    numero: integer("numero").notNull(),
    /** Como se muestra e imprime: prefijo del frasco + numero. */
    codigo: text("codigo").notNull(),

    maquinaId: integer("maquina_id")
      .notNull()
      .references(() => maquinas.id),
    frascoId: integer("frasco_id")
      .notNull()
      .references(() => frascos.id),

    // Snapshots: si despues renombran la maquina o el frasco, el historial
    // del lote sigue diciendo lo que decia cuando se produjo.
    maquinaNombre: text("maquina_nombre").notNull(),
    frascoNombre: text("frasco_nombre").notNull(),

    /** Capacidad o meta del lote. Se elige la unidad al abrirlo. */
    limite: integer("limite").notNull(),
    /** 'cajas' | 'unidades' */
    limiteUnidad: text("limite_unidad").notNull().default("unidades"),

    /** 'preparado' | 'abierto' | 'cerrado' */
    estado: text("estado").notNull().default("preparado"),

    preparadoPor: text("preparado_por"),
    preparadoEn: ts("preparado_en").notNull().default(AHORA),
    abiertoEn: ts("abierto_en"),
    cerradoEn: ts("cerrado_en"),
    /** 'limite' | 'manual' | 'cancelado' */
    cerradoMotivo: text("cerrado_motivo"),
    cerradoPor: text("cerrado_por"),
    nota: text("nota"),
  },
  (t) => [
    // La numeracion es por producto: el lote 100 del 100ml y el 100 del 500ml
    // son dos lotes distintos, pero no puede haber dos "100" del mismo frasco.
    unique("uq_lote_frasco_numero").on(t.frascoId, t.numero),
    index("ix_lotes_maquina_estado").on(t.maquinaId, t.estado),
    index("ix_lotes_estado").on(t.estado),
  ]
);

// ---------------------------------------------------------------------------
// Etiquetas: append-only. Nada se borra: anular es un estado, no un DELETE.
// ---------------------------------------------------------------------------

export const etiquetas = pgTable(
  "etiquetas",
  {
    id: serial("id").primaryKey(),
    loteId: integer("lote_id")
      .notNull()
      .references(() => lotes.id),
    caja: integer("caja").notNull(),
    cantidad: integer("cantidad").notNull(),

    operarioId: integer("operario_id")
      .notNull()
      .references(() => operarios.id),

    // Snapshots historicos. Una etiqueta es un documento: tiene que seguir
    // diciendo lo mismo aunque despues cambien los catalogos.
    loteCodigo: text("lote_codigo").notNull(),
    maquinaNombre: text("maquina_nombre").notNull(),
    frascoNombre: text("frasco_nombre").notNull(),
    operarioNombre: text("operario_nombre").notNull(),
    turno: text("turno").notNull(),

    creadoEn: ts("creado_en").notNull().default(AHORA),

    // Calidad: pendiente | liberada | rechazada
    estadoCalidad: text("estado_calidad").notNull().default("pendiente"),
    calidadPor: text("calidad_por"),
    calidadEn: ts("calidad_en"),
    calidadNota: text("calidad_nota"),

    // Anulacion (reemplaza al borrado)
    anulada: boolean("anulada").notNull().default(false),
    anuladaPor: text("anulada_por"),
    anuladaEn: ts("anulada_en"),
    anuladaMotivo: text("anulada_motivo"),

    // Trazabilidad de impresion.
    impresiones: integer("impresiones").notNull().default(0),
    ultimaImpresionEn: ts("ultima_impresion_en"),
  },
  (t) => [
    // EL SEGURO. Esto es lo que hace imposible tener dos cajas con el mismo
    // numero dentro de un lote, incluso si dos clientes escriben a la vez.
    unique("uq_etiqueta_lote_caja").on(t.loteId, t.caja),
    index("ix_etiquetas_lote").on(t.loteId),
    index("ix_etiquetas_creado").on(t.creadoEn),
    index("ix_etiquetas_estado").on(t.estadoCalidad),
  ]
);

// ---------------------------------------------------------------------------
// Auditoria: quien hizo que. En trazabilidad esto no es opcional.
// ---------------------------------------------------------------------------

export const auditoria = pgTable(
  "auditoria",
  {
    id: serial("id").primaryKey(),
    accion: text("accion").notNull(), // etiqueta.crear, lote.preparar, lote.cerrar, ...
    entidad: text("entidad").notNull(),
    entidadId: integer("entidad_id"),
    actor: text("actor"),
    detalle: text("detalle"), // JSON con el antes/despues
    creadoEn: ts("creado_en").notNull().default(AHORA),
  },
  (t) => [index("ix_auditoria_creado").on(t.creadoEn)]
);

// ---------------------------------------------------------------------------
// Configuracion: clave/valor. Los PINs van hasheados, nunca en texto plano
// y nunca bajan al navegador.
// ---------------------------------------------------------------------------

export const configuracion = pgTable("configuracion", {
  clave: text("clave").primaryKey(),
  valor: text("valor").notNull(),
  actualizadoEn: ts("actualizado_en").notNull().default(AHORA),
});

/** Intentos fallidos de PIN, para frenar fuerza bruta desde una URL publica. */
export const intentosPin = pgTable(
  "intentos_pin",
  {
    id: serial("id").primaryKey(),
    origen: text("origen").notNull(), // IP o "desconocido"
    creadoEn: ts("creado_en").notNull().default(AHORA),
  },
  (t) => [index("ix_intentos_origen").on(t.origen, t.creadoEn)]
);

export type Etiqueta = typeof etiquetas.$inferSelect;
export type Lote = typeof lotes.$inferSelect;
export type Maquina = typeof maquinas.$inferSelect;
export type Frasco = typeof frascos.$inferSelect;
