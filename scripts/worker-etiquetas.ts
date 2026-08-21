/**
 * Proceso worker del test de concurrencia. No se corre a mano.
 * Cada instancia abre SU PROPIA conexion al mismo archivo SQLite, asi que la
 * pelea por el lock de escritura es real, a nivel sistema operativo.
 *
 *   tsx scripts/worker-etiquetas.ts <modo> <maquinaId> <operarioId> <cantidad>
 *
 * modo = nuevo  -> usa crearEtiqueta() (transaccion IMMEDIATE + UNIQUE)
 * modo = viejo  -> replica la logica del artifact original: leer el contador,
 *                  incrementarlo en memoria, escribirlo. Sin transaccion.
 */
import Database from "better-sqlite3";
import path from "node:path";
import { crearEtiqueta } from "../src/lib/etiquetas";

const [modo, maquinaIdRaw, operarioIdRaw, cantidadRaw] = process.argv.slice(2);
const maquinaId = Number(maquinaIdRaw);
const operarioId = Number(operarioIdRaw);
const cantidad = Number(cantidadRaw);

let ok = 0;
let rechazos = 0;

if (modo === "nuevo") {
  for (let i = 0; i < cantidad; i++) {
    try {
      crearEtiqueta({ maquinaId, operarioId, turno: "Mañana", cantidad: 240, actor: "test" });
      ok++;
    } catch (e) {
      // Un rechazo NO es una perdida de datos: es la base defendiendose.
      // En la app real esto se reintenta y el operario nunca lo ve.
      rechazos++;
      if (!String(e).includes("UNIQUE") && !String(e).includes("SQLITE_BUSY")) {
        console.error("  error inesperado:", String(e).slice(0, 120));
      }
    }
  }
} else {
  // --- Replica del bug original ---------------------------------------------
  // El artifact hace: nextCaja = machine.cajaCounter + 1, y despues persiste.
  // Entre la lectura y la escritura hay un hueco. Eso es la carrera.
  const file = path.join(process.cwd(), "data", "etiquetado.db");
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");

  const leer = sqlite.prepare("SELECT valor FROM demo_viejo_contador WHERE lote_id = ?");
  const escribir = sqlite.prepare("UPDATE demo_viejo_contador SET valor = ? WHERE lote_id = ?");
  const insertar = sqlite.prepare("INSERT INTO demo_viejo_etiquetas (lote_id, caja) VALUES (?, ?)");

  for (let i = 0; i < cantidad; i++) {
    const fila = leer.get(maquinaId) as { valor: number } | undefined;
    const proxima = (fila?.valor ?? 0) + 1;
    // El hueco: en el artifact es el tiempo de red + render de React.
    // Aca lo hacemos explicito con un poco de trabajo sincronico.
    for (let k = 0; k < 40000; k++) Math.sqrt(k);
    escribir.run(proxima, maquinaId);
    insertar.run(maquinaId, proxima);
    ok++;
  }
  sqlite.close();
}

console.log(JSON.stringify({ pid: process.pid, modo, ok, rechazos }));
