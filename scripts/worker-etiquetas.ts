/**
 * Proceso worker del test de concurrencia. No se corre a mano.
 *
 * Cada instancia abre SU PROPIA conexión a la base, así que la pelea por el
 * número de caja es real: procesos distintos, conexiones distintas.
 *
 *   tsx scripts/worker-etiquetas.ts <modo> <maquinaId> <operarioId> <cantidad>
 *
 * modo = nuevo  -> usa crearEtiqueta() (UNIQUE(lote, caja) + reintento)
 * modo = viejo  -> replica la lógica del artifact original: leer el contador,
 *                  incrementarlo en memoria, escribirlo. Sin transacción.
 */
import { sql } from "drizzle-orm";
import { cerrarConexion, db } from "../src/db";
import { crearEtiqueta } from "../src/lib/etiquetas";

const [modo, maquinaIdRaw, operarioIdRaw, cantidadRaw] = process.argv.slice(2);
const maquinaId = Number(maquinaIdRaw);
const operarioId = Number(operarioIdRaw);
const cantidad = Number(cantidadRaw);

async function main() {
  let ok = 0;
  let rechazos = 0;

  if (modo === "nuevo") {
    for (let i = 0; i < cantidad; i++) {
      try {
        await crearEtiqueta({
          maquinaId,
          operarioId,
          turno: "Mañana",
          cantidad: 240,
          actor: "test",
        });
        ok++;
      } catch (e) {
        // Un rechazo NO es pérdida de datos: es la base defendiéndose, y el
        // reintento interno ya lo cubre. Si llega acá es algo distinto.
        rechazos++;
        console.error("  error inesperado:", String(e).slice(0, 160));
      }
    }
  } else {
    // --- Réplica del bug original -------------------------------------------
    // El artifact hacía: nextCaja = machine.cajaCounter + 1, y después
    // persistía. Entre la lectura y la escritura hay un hueco. Ahí está la
    // carrera.
    for (let i = 0; i < cantidad; i++) {
      const filas = await db.execute(
        sql`select valor from demo_viejo_contador where lote_id = ${maquinaId}`
      );
      const arr = (Array.isArray(filas) ? filas : (filas as { rows?: unknown[] }).rows ?? []) as {
        valor: number;
      }[];
      const proxima = (arr[0]?.valor ?? 0) + 1;

      // El hueco: en el artifact era el tiempo de red más el render de React.
      // Acá se hace explícito con un poco de trabajo sincrónico.
      for (let k = 0; k < 40000; k++) Math.sqrt(k);

      await db.execute(
        sql`update demo_viejo_contador set valor = ${proxima} where lote_id = ${maquinaId}`
      );
      await db.execute(
        sql`insert into demo_viejo_etiquetas (lote_id, caja) values (${maquinaId}, ${proxima})`
      );
      ok++;
    }
  }

  console.log(JSON.stringify({ pid: process.pid, modo, ok, rechazos }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => cerrarConexion());
