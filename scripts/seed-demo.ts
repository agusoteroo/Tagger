/**
 * Genera produccion historica de ejemplo para poder ver y probar las metricas.
 *
 *   npm run db:demo
 *
 * SOLO desarrollo. Inserta directo en la tabla (salteando crearEtiqueta) porque
 * necesita fechas pasadas, y crearEtiqueta usa a proposito el reloj del servidor.
 */
import { eq, sql } from "drizzle-orm";
import { cerrarConexion, db } from "../src/db";
import { etiquetas, frascos, lotes, maquinas, operarios, turnos } from "../src/db/schema";
import { migrar } from "../src/db/migrar";
import { ZONA } from "../src/lib/tiempo";

if (process.env.NODE_ENV === "production") {
  console.error("Negado en produccion.");
  process.exit(1);
}

const DIAS = 12;
// Ritmo distinto por operario, para que las metricas muestren diferencias reales.
const RITMO: Record<string, { cajasPorTurno: number; minEntreCajas: number; rechazo: number }> = {
  "Juan Pérez": { cajasPorTurno: 22, minEntreCajas: 11, rechazo: 0.02 },
  "María González": { cajasPorTurno: 28, minEntreCajas: 9, rechazo: 0.01 },
  "Carlos Sosa": { cajasPorTurno: 16, minEntreCajas: 15, rechazo: 0.06 },
  "Lucía Ramírez": { cajasPorTurno: 25, minEntreCajas: 10, rechazo: 0.03 },
};
// Hora local de inicio de cada turno.
const INICIO: Record<string, number> = { Mañana: 6, Tarde: 14, Noche: 22 };

/** PRNG con semilla: la demo tiene que ser reproducible. */
let semilla = 12345;
function rnd() {
  semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
  return semilla / 0x7fffffff;
}

/**
 * Fecha/hora LOCAL de la planta como expresion SQL.
 *
 * La conversion la hace Postgres, que conoce la zona: asi el fixture no depende
 * de la zona del proceso que corre el script (en CI o en Vercel es UTC).
 */
function local(diasAtras: number, horaLocal: number, minuto: number) {
  const hh = String(horaLocal).padStart(2, "0");
  const mm = String(minuto % 60).padStart(2, "0");
  const extraHoras = Math.floor(minuto / 60);
  const h = String(horaLocal + extraHoras).padStart(2, "0");
  return sql`((current_date - ${diasAtras}::int)::text || ' ' || ${extraHoras ? h : hh} || ':' || ${mm})::timestamp AT TIME ZONE ${ZONA}`;
}

async function main() {
  await migrar();
  const ops = await db.select().from(operarios);
  const maqs = await db.select().from(maquinas);
  const trs = await db.select().from(turnos);
  if (!ops.length || !maqs.length || !trs.length) {
    console.error("Corre primero: npm run db:seed");
    process.exit(1);
  }

  // Un lote por maquina y por dia, como pasaria en la realidad. Los numeros
  // siguen la secuencia POR FRASCO, igual que en produccion.
  const proximoNumero = new Map<number, number>();
  async function numeroDe(frascoId: number) {
    if (!proximoNumero.has(frascoId)) {
      const [r] = await db
        .select({ m: sql<number>`coalesce(max(${lotes.numero}), 0)::int` })
        .from(lotes)
        .where(eq(lotes.frascoId, frascoId));
      proximoNumero.set(frascoId, (r?.m ?? 0) + 1);
    }
    const n = proximoNumero.get(frascoId)!;
    proximoNumero.set(frascoId, n + 1);
    return n;
  }

  let cajasTotal = 0;
  await db.transaction(async (tx) => {
    for (let d = DIAS; d >= 1; d--) {
      const etiqueta = `${String(new Date(Date.now() - d * 86400000).getUTCDate()).padStart(2, "0")}`;

      for (const maq of maqs) {
        const [frasco] = await tx.select().from(frascos).where(eq(frascos.id, maq.frascoId!));
        if (!frasco) continue;

        const numero = await numeroDe(frasco.id);
        const [lote] = await tx
          .insert(lotes)
          .values({
            numero,
            codigo: frasco.prefijoLote ? `${frasco.prefijoLote}-${numero}` : String(numero),
            maquinaId: maq.id,
            frascoId: frasco.id,
            maquinaNombre: maq.nombre,
            frascoNombre: frasco.nombre,
            limite: (frasco.cantidadEstandar ?? 100) * 60,
            limiteUnidad: "unidades",
            estado: "cerrado",
            preparadoPor: "demo",
            preparadoEn: local(d, 5, 30),
            abiertoEn: local(d, 6, 0),
            cerradoEn: local(d, 23, 59),
            cerradoMotivo: "limite",
            cerradoPor: "sistema",
          })
          .returning();

        let caja = 0;
        for (const turno of trs) {
          // No todas las maquinas trabajan todos los turnos.
          if (rnd() < 0.25) continue;
          const op = ops[Math.floor(rnd() * ops.length)];
          const r = RITMO[op.nombre] ?? { cajasPorTurno: 20, minEntreCajas: 12, rechazo: 0.03 };
          const cuantas = Math.max(3, Math.round(r.cajasPorTurno * (0.75 + rnd() * 0.5)));

          for (let i = 0; i < cuantas; i++) {
            caja++;
            const minuto = Math.round(i * r.minEntreCajas * (0.8 + rnd() * 0.4));
            const horaBase = INICIO[turno.nombre] ?? 6;
            // El turno noche cruza la medianoche: eso es justo lo que valida
            // que el agrupado por dia local funcione.
            const estado = rnd() < r.rechazo ? "rechazada" : rnd() < 0.12 ? "pendiente" : "liberada";
            const anulada = rnd() < 0.008;

            await tx.insert(etiquetas).values({
                loteId: lote.id,
                caja,
                cantidad: frasco.cantidadEstandar ?? 100,
                operarioId: op.id,
                loteCodigo: lote.codigo,
                maquinaNombre: maq.nombre,
                frascoNombre: frasco.nombre,
                operarioNombre: op.nombre,
                turno: turno.nombre,
                creadoEn: local(d, horaBase, minuto),
                estadoCalidad: estado,
                calidadPor: estado === "pendiente" ? null : "Inspector Ruiz",
                calidadEn: estado === "pendiente" ? null : local(d, horaBase + 2, minuto),
                anulada,
                anuladaPor: anulada ? "admin" : null,
                anuladaEn: anulada ? local(d, horaBase + 1, minuto) : null,
                anuladaMotivo: anulada ? "Caja dañada" : null,
                impresiones: 1,
            });
            cajasTotal++;
          }
        }
      }
    }
  });

  console.log(`\n  ${cajasTotal} etiquetas generadas sobre ${DIAS} dias.`);
  const [t] = await db
    .select({
      cajas: sql<number>`count(*)::int`,
      unidades: sql<number>`coalesce(sum(${etiquetas.cantidad}), 0)::int`,
      desde: sql<string>`min(${etiquetas.creadoEn})`,
      hasta: sql<string>`max(${etiquetas.creadoEn})`,
    })
    .from(etiquetas);
  console.log(`  rango: ${t.desde} .. ${t.hasta}`);
  console.log(`  total en base: ${t.cajas} cajas / ${t.unidades} unidades\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => cerrarConexion());
