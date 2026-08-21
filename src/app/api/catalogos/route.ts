import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { etiquetas, frascos, lotes, maquinas, operarios, turnos } from "@/db/schema";
import { handler, rolActual } from "@/lib/api";
import { permisosDe, pinsConfigurados } from "@/lib/auth";
import { colaPorMaquina } from "@/lib/lotes";

/**
 * GET /api/catalogos
 * Todo lo que la pantalla necesita para arrancar, en un pedido: catálogos, el
 * lote abierto de cada máquina con su progreso contra el límite, y cuántos
 * lotes esperan en la cola.
 *
 * Los PINs NO están acá. Nunca bajan al navegador.
 */
export async function GET() {
  return handler(async () => {
    const rol = await rolActual();

    /**
     * El progreso y la próxima caja se calculan con subconsultas en la MISMA
     * consulta de máquinas.
     *
     * Antes era una consulta por máquina dentro de un `.map()`. Contra SQLite
     * local eso no se notaba; contra una base remota son N viajes de red que se
     * suman uno atrás del otro.
     */
    const maqs = await db
      .select({
        id: maquinas.id,
        nombre: maquinas.nombre,
        activa: maquinas.activa,
        frascoId: maquinas.frascoId,
        frascoNombre: frascos.nombre,
        cantidadEstandar: frascos.cantidadEstandar,
        loteId: lotes.id,
        loteNumero: lotes.numero,
        loteCodigo: lotes.codigo,
        loteAbiertoEn: lotes.abiertoEn,
        limite: lotes.limite,
        limiteUnidad: lotes.limiteUnidad,
        progresoCajas: sql<number>`coalesce((
          select count(*)::int from ${etiquetas}
          where ${etiquetas.loteId} = ${lotes.id} and ${etiquetas.anulada} = false
        ), 0)`,
        progresoUnidades: sql<number>`coalesce((
          select sum(${etiquetas.cantidad})::int from ${etiquetas}
          where ${etiquetas.loteId} = ${lotes.id} and ${etiquetas.anulada} = false
        ), 0)`,
        // La próxima caja NO filtra anuladas: una caja anulada ocupa su número,
        // y el hueco en la secuencia es la evidencia de que ahí hubo una caja.
        proximaCaja: sql<number>`coalesce((
          select max(${etiquetas.caja})::int from ${etiquetas}
          where ${etiquetas.loteId} = ${lotes.id}
        ), 0) + 1`,
      })
      .from(maquinas)
      .leftJoin(frascos, eq(maquinas.frascoId, frascos.id))
      .leftJoin(lotes, eq(maquinas.loteActualId, lotes.id))
      .where(eq(maquinas.activa, true))
      .orderBy(asc(maquinas.nombre));

    // El resto son consultas independientes: van todas en paralelo.
    const [cola, listaOperarios, listaTurnos, listaFrascos, pendientes, pins] = await Promise.all([
      colaPorMaquina(),
      db
        .select({ id: operarios.id, nombre: operarios.nombre })
        .from(operarios)
        .where(eq(operarios.activo, true))
        .orderBy(asc(operarios.nombre)),
      db
        .select({ id: turnos.id, nombre: turnos.nombre })
        .from(turnos)
        .where(eq(turnos.activo, true))
        .orderBy(asc(turnos.orden)),
      db
        .select({
          id: frascos.id,
          nombre: frascos.nombre,
          cantidadEstandar: frascos.cantidadEstandar,
          prefijoLote: frascos.prefijoLote,
        })
        .from(frascos)
        .where(eq(frascos.activo, true))
        .orderBy(asc(frascos.nombre)),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(etiquetas)
        .where(and(eq(etiquetas.estadoCalidad, "pendiente"), eq(etiquetas.anulada, false))),
      pinsConfigurados(),
    ]);

    const conProgreso = maqs.map((m) => {
      if (!m.loteId) {
        return {
          ...m,
          proximaCaja: null,
          progresoCajas: 0,
          progresoUnidades: 0,
          hecho: 0,
          restante: 0,
          porcentaje: 0,
          enCola: cola.get(m.id) ?? 0,
        };
      }
      const hecho = m.limiteUnidad === "cajas" ? m.progresoCajas : m.progresoUnidades;
      const limite = m.limite ?? 0;
      return {
        ...m,
        hecho,
        restante: Math.max(0, limite - hecho),
        porcentaje: limite > 0 ? Math.round((hecho / limite) * 100) : 0,
        enCola: cola.get(m.id) ?? 0,
      };
    });

    return {
      rol,
      // Bandera de ambiente. Se define con MODO_DEMO=1 en el .env, para que la
      // pantalla avise que los datos son de prueba y se van a borrar.
      modoDemo: process.env.MODO_DEMO === "1",
      permisos: permisosDe(rol),
      pins,
      maquinas: conProgreso,
      operarios: listaOperarios,
      turnos: listaTurnos,
      frascos: listaFrascos,
      pendientesCalidad: pendientes[0]?.n ?? 0,
      // Máquinas paradas por falta de lote: es lo que el jefe tiene que ver ya.
      sinLote: conProgreso.filter((m) => !m.loteId).length,
    };
  });
}

export const dynamic = "force-dynamic";
