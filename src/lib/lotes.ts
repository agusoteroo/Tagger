import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditoria, etiquetas, frascos, lotes, maquinas } from "@/db/schema";
import { ErrorNegocio } from "./errores";
import { conReintentoUnico } from "./reintento";

export type Unidad = "cajas" | "unidades";
/**
 * Ya no hay estado "preparado".
 *
 * Existia cuando el lote se cerraba solo al llegar al limite y el siguiente
 * esperaba en una cola para arrancar sin que el jefe intervenga. El cliente
 * corrigio la regla: el lote NO se cierra por cantidad, se cierra cuando en esa
 * maquina arranca otro lote. Con eso, cargar un lote ES el cambio de
 * produccion, y no hay nada que esperar en una cola.
 */
export type EstadoLote = "abierto" | "cerrado";

/** El `tx` que pasa drizzle dentro de una transaccion. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Sirve tanto `db` como un `tx`: las consultas de lectura aceptan los dos. */
type Ejecutor = Pick<typeof db, "select" | "insert" | "update" | "delete">;

async function auditar(
  tx: Ejecutor,
  accion: string,
  id: number | null,
  actor: string | null,
  detalle?: unknown
) {
  await tx.insert(auditoria).values({
    accion,
    entidad: "lote",
    entidadId: id,
    actor,
    detalle: detalle === undefined ? null : JSON.stringify(detalle),
  });
}

/** Cuanto lleva producido un lote. Las anuladas NO cuentan: la caja no sirve. */
export async function progreso(loteId: number, tx: Ejecutor = db) {
  const [r] = await tx
    .select({
      cajas: sql<number>`count(*)::int`,
      unidades: sql<number>`coalesce(sum(${etiquetas.cantidad}), 0)::int`,
    })
    .from(etiquetas)
    .where(and(eq(etiquetas.loteId, loteId), eq(etiquetas.anulada, false)));
  return { cajas: r?.cajas ?? 0, unidades: r?.unidades ?? 0 };
}

/**
 * Si el lote ya llego a la cantidad planificada.
 *
 * OJO con el nombre: antes esto se llamaba `limiteAlcanzado` y disparaba el
 * cierre. Ya no cierra nada. El limite es un OBJETIVO: se avisa que se cumplio
 * y la maquina sigue etiquetando todo lo que haga falta, porque quien decide
 * cortar es el jefe cambiando la produccion, no un contador.
 *
 * Se renombro justamente para que nadie lo vuelva a usar como disparador.
 */
export function objetivoCumplido(
  lote: { limite: number; limiteUnidad: string },
  p: { cajas: number; unidades: number }
) {
  const hecho = lote.limiteUnidad === "cajas" ? p.cajas : p.unidades;
  return hecho >= lote.limite;
}

/** Cuanto del objetivo lleva, en porcentaje. Puede pasar de 100. */
export function porcentajeObjetivo(
  lote: { limite: number; limiteUnidad: string },
  p: { cajas: number; unidades: number }
) {
  if (!lote.limite || lote.limite <= 0) return 0;
  const hecho = lote.limiteUnidad === "cajas" ? p.cajas : p.unidades;
  return Math.round((hecho / lote.limite) * 100);
}

function codigoDe(prefijo: string | null, numero: number) {
  return prefijo?.trim() ? `${prefijo.trim()}-${numero}` : String(numero);
}

// ---------------------------------------------------------------------------
// Abrir un lote (el formulario del jefe de planta)
// ---------------------------------------------------------------------------

/**
 * Abre un lote en una maquina. Si habia otro abierto, LO CIERRA.
 *
 * Esta es la regla del negocio, y es la que corrigio el cliente: el lote no
 * termina por llegar a una cantidad, termina cuando esa maquina se pone a hacer
 * otra cosa. Si estoy haciendo frascos de 250 y cargo un lote de potes de 100,
 * el lote de 250 se cerro en ese momento -- haya hecho el 60% o el 130% de lo
 * planificado.
 *
 * Cierra tambien si el producto es el MISMO: una maquina tiene un solo lote a la
 * vez, sin excepciones. Es la regla mas simple de explicar en planta y no deja
 * casos raros. El precio es que un clic de mas cierra un lote que recien
 * arranco, asi que se devuelve que se cerro y con cuanto, para que la pantalla
 * lo muestre antes de confirmar.
 *
 * El numero es secuencial POR FRASCO: si dos maquinas hacen el mismo producto,
 * la segunda toma el siguiente y nunca colisionan.
 */
export async function abrirLote(input: {
  maquinaId: number;
  frascoId?: number;
  limite: number;
  limiteUnidad: Unidad;
  nota?: string;
  actor: string;
}) {
  if (!Number.isInteger(input.limite) || input.limite <= 0) {
    throw new ErrorNegocio("El límite tiene que ser un número entero mayor a cero.");
  }
  if (input.limiteUnidad !== "cajas" && input.limiteUnidad !== "unidades") {
    throw new ErrorNegocio("La unidad del límite tiene que ser 'cajas' o 'unidades'.");
  }

  // El reintento cubre el caso de que dos lotes del mismo producto se creen a
  // la vez: la restriccion UNIQUE(frasco, numero) rechaza uno y se reintenta.
  return conReintentoUnico(
    () =>
      db.transaction(async (tx) => {
        const [maq] = await tx.select().from(maquinas).where(eq(maquinas.id, input.maquinaId));
        if (!maq) throw new ErrorNegocio("La máquina no existe.", 404);
        if (!maq.activa) throw new ErrorNegocio(`La máquina ${maq.nombre} está inactiva.`);

        const frascoId = input.frascoId ?? maq.frascoId;
        if (!frascoId) throw new ErrorNegocio("Hay que indicar qué producto va a hacer este lote.");

        const [frasco] = await tx.select().from(frascos).where(eq(frascos.id, frascoId));
        if (!frasco) throw new ErrorNegocio("El producto elegido no existe.", 404);

        /**
         * Cerrar el que estaba abierto, ANTES de insertar el nuevo.
         *
         * El orden importa: hay un indice unico parcial que permite un solo lote
         * abierto por maquina, asi que insertar el nuevo con el viejo todavia
         * abierto lo viola.
         *
         * (Primero lo habia hecho al revés, con el argumento de que si crear el
         * nuevo fallaba la maquina no quedara sin lote. Era un razonamiento
         * vacio: las dos operaciones estan en la MISMA transaccion, asi que un
         * fallo revierte todo igual. El orden no protegia de nada y rompia el
         * indice.)
         */
        const [anterior] = await tx
          .select()
          .from(lotes)
          .where(and(eq(lotes.maquinaId, maq.id), eq(lotes.estado, "abierto")));

        let cerrado: { codigo: string; cajas: number; unidades: number; porcentaje: number } | null =
          null;
        if (anterior) {
          const p = await cerrarEnTx(tx, anterior, "cambio", input.actor);
          cerrado = { codigo: anterior.codigo, ...p, porcentaje: porcentajeObjetivo(anterior, p) };
        }

        // Numero siguiente de la secuencia de ESTE producto.
        const [fila] = await tx
          .select({ prox: sql<number>`(coalesce(max(${lotes.numero}), 0) + 1)::int` })
          .from(lotes)
          .where(eq(lotes.frascoId, frasco.id));
        const numero = fila?.prox ?? 1;

        const [lote] = await tx
          .insert(lotes)
          .values({
            numero,
            codigo: codigoDe(frasco.prefijoLote, numero),
            maquinaId: maq.id,
            frascoId: frasco.id,
            maquinaNombre: maq.nombre,
            frascoNombre: frasco.nombre,
            limite: input.limite,
            limiteUnidad: input.limiteUnidad,
            // Siempre abierto: no hay cola, cargar un lote ES arrancarlo.
            estado: "abierto",
            preparadoPor: input.actor,
            abiertoEn: sql`now()`,
            nota: input.nota?.trim() || null,
          })
          .returning();

        // Abrir un lote es tambien el momento en que cambia lo que produce la
        // maquina: es la misma accion vista desde el catalogo.
        await tx
          .update(maquinas)
          .set({ loteActualId: lote.id, frascoId: frasco.id })
          .where(eq(maquinas.id, maq.id));

        await auditar(tx, "lote.abrir", lote.id, input.actor, {
          numero,
          codigo: lote.codigo,
          maquina: maq.nombre,
          frasco: frasco.nombre,
          limite: input.limite,
          unidad: input.limiteUnidad,
          // Queda asentado que este lote desplazo a otro, y con cuanto lo dejo.
          cerroA: cerrado,
        });

        return { lote, cerrado };
      }),
    // Solo se reintenta la colision de numero. Si lo que falla es
    // "un solo lote abierto por maquina", eso es un error de logica y tiene que
    // salir a la luz, no esconderse detras de ocho reintentos.
    { que: "el lote", soloRestriccion: "uq_lote_frasco_numero" }
  );
}

// ---------------------------------------------------------------------------
// Cierre
// ---------------------------------------------------------------------------

/**
 * Cierra un lote y deja la maquina sin lote.
 *
 * Antes esto se llamaba `cerrarYAvanzarEnTx` y ademas activaba el siguiente de
 * una cola de lotes "preparados". Eso existia porque el lote se cerraba solo al
 * llegar al limite, y la cola evitaba que la linea se detuviera esperando al
 * jefe. Ya no aplica: el lote se cierra cuando arranca otro, asi que la
 * apertura del siguiente es una decision explicita de una persona, no algo que
 * el sistema tenga que adivinar.
 *
 * Si quien cierra es `abrirLote`, va a poner el lote nuevo en la maquina
 * inmediatamente despues. Si es un cierre manual, la maquina queda parada, y eso
 * es correcto: el jefe decidio que no se produce mas hasta nuevo aviso.
 *
 * Devuelve el progreso con el que quedo, para poder informarlo.
 */
export async function cerrarEnTx(
  tx: Tx,
  lote: { id: number; maquinaId: number; codigo: string },
  motivo: "cambio" | "manual",
  actor: string | null
) {
  await tx
    .update(lotes)
    .set({ estado: "cerrado", cerradoEn: sql`now()`, cerradoMotivo: motivo, cerradoPor: actor })
    .where(eq(lotes.id, lote.id));

  await tx.update(maquinas).set({ loteActualId: null }).where(eq(maquinas.id, lote.maquinaId));

  const p = await progreso(lote.id, tx);
  await auditar(tx, "lote.cerrar", lote.id, actor, { motivo, codigo: lote.codigo, ...p });
  return p;
}

/**
 * Cierre manual: el jefe corta el lote y la maquina queda parada.
 *
 * Es distinto de cambiar de produccion. Aca no arranca nada: sirve para cortar
 * turno, parar por mantenimiento, o cerrar un lote que se dio por terminado sin
 * tener el siguiente definido.
 */
export async function cerrarLoteManual(input: { loteId: number; actor: string }) {
  return db.transaction(async (tx) => {
    const [lote] = await tx.select().from(lotes).where(eq(lotes.id, input.loteId));
    if (!lote) throw new ErrorNegocio("El lote no existe.", 404);
    if (lote.estado === "cerrado") throw new ErrorNegocio("El lote ya está cerrado.");

    const p = await cerrarEnTx(tx, lote, "manual", input.actor);
    return {
      cerrado: lote.codigo,
      ...p,
      porcentaje: porcentajeObjetivo(lote, p),
      // La maquina queda sin lote: quien la use tiene que saber que para
      // producir de nuevo hace falta abrir uno.
      maquinaParada: true,
    };
  });
}

/** Editar el objetivo de un lote abierto (el jefe se equivoco al cargarlo). */
export async function editarLimite(input: {
  loteId: number;
  limite: number;
  limiteUnidad: Unidad;
  actor: string;
}) {
  if (!Number.isInteger(input.limite) || input.limite <= 0) {
    throw new ErrorNegocio("El límite tiene que ser un número entero mayor a cero.");
  }
  return db.transaction(async (tx) => {
    const [lote] = await tx.select().from(lotes).where(eq(lotes.id, input.loteId));
    if (!lote) throw new ErrorNegocio("El lote no existe.", 404);
    if (lote.estado === "cerrado") throw new ErrorNegocio("El lote ya está cerrado.");

    await tx
      .update(lotes)
      .set({ limite: input.limite, limiteUnidad: input.limiteUnidad })
      .where(eq(lotes.id, lote.id));
    await auditar(tx, "lote.editarLimite", lote.id, input.actor, {
      codigo: lote.codigo,
      antes: { limite: lote.limite, unidad: lote.limiteUnidad },
      despues: { limite: input.limite, unidad: input.limiteUnidad },
    });

    /**
     * Antes, si el objetivo nuevo ya quedaba alcanzado, el lote se cerraba en el
     * acto. Ya no: el objetivo no cierra nada. Bajarlo por debajo de lo ya
     * producido es legitimo -- el jefe se dio cuenta de que planifico de mas --
     * y el lote sigue abierto hasta que cambie la produccion.
     */
    const p = await progreso(lote.id, tx);
    return {
      ajustado: true,
      ...p,
      porcentaje: porcentajeObjetivo({ limite: input.limite, limiteUnidad: input.limiteUnidad }, p),
    };
  });
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export async function listarLotes(
  f: { estado?: EstadoLote; maquinaId?: number; limit?: number } = {}
) {
  const cond = [];
  if (f.estado) cond.push(eq(lotes.estado, f.estado));
  if (f.maquinaId) cond.push(eq(lotes.maquinaId, f.maquinaId));

  // El progreso se calcula en la misma consulta con un subselect, no con una
  // consulta por lote. Contra una base remota, N+1 se paga en latencia de red.
  const filas = await db
    .select({
      id: lotes.id,
      numero: lotes.numero,
      codigo: lotes.codigo,
      maquinaId: lotes.maquinaId,
      frascoId: lotes.frascoId,
      maquinaNombre: lotes.maquinaNombre,
      frascoNombre: lotes.frascoNombre,
      limite: lotes.limite,
      limiteUnidad: lotes.limiteUnidad,
      estado: lotes.estado,
      preparadoPor: lotes.preparadoPor,
      preparadoEn: lotes.preparadoEn,
      abiertoEn: lotes.abiertoEn,
      cerradoEn: lotes.cerradoEn,
      cerradoMotivo: lotes.cerradoMotivo,
      cerradoPor: lotes.cerradoPor,
      nota: lotes.nota,
      progresoCajas: sql<number>`(
        select count(*)::int from ${etiquetas}
        where ${etiquetas.loteId} = ${lotes.id} and ${etiquetas.anulada} = false
      )`,
      progresoUnidades: sql<number>`(
        select coalesce(sum(${etiquetas.cantidad}), 0)::int from ${etiquetas}
        where ${etiquetas.loteId} = ${lotes.id} and ${etiquetas.anulada} = false
      )`,
    })
    .from(lotes)
    .where(cond.length ? and(...cond) : undefined)
    // El abierto primero, despues los cerrados del mas reciente al mas viejo.
    .orderBy(
      sql`case ${lotes.estado} when 'abierto' then 0 else 1 end`,
      desc(lotes.preparadoEn),
      desc(lotes.id)
    )
    .limit(Math.min(f.limit ?? 200, 1000));

  return filas.map((l) => {
    const hecho = l.limiteUnidad === "cajas" ? l.progresoCajas : l.progresoUnidades;
    return {
      ...l,
      hecho,
      // Puede pasar de 100, y ahora eso es normal: el objetivo no cierra el
      // lote, asi que la produccion sigue hasta que cambie lo que hace la
      // maquina. El excedente es un dato del reporte, no un error.
      porcentaje: l.limite > 0 ? Math.round((hecho / l.limite) * 100) : 0,
      restante: Math.max(0, l.limite - hecho),
      excedente: Math.max(0, hecho - l.limite),
      objetivoCumplido: l.limite > 0 && hecho >= l.limite,
    };
  });
}

export type LoteConProgreso = Awaited<ReturnType<typeof listarLotes>>[number];
