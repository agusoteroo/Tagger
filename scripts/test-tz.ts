/**
 * Verifica que importar los modulos NO haga trabajo que pueda fallar.
 *
 * Los dos casos que rompieron el build de Vercel: TZ_PLANTA="" y sin definir.
 * Los imports son ESTATICOS a proposito: es justo la evaluacion al importar la
 * que queremos que no explote. `next build` importa todas las rutas para
 * recolectar su configuracion, asi que cualquier throw ahi rompe el build
 * entero en vez de fallar en la peticion que de verdad usa la zona.
 *
 * Uso: tsx scripts/tz-import-check.ts <zona-esperada> [debe-fallar-al-usar]
 */
import { ZONA, diaLocal } from "@/lib/tiempo";
import { esDimension } from "@/lib/metricas";
import "@/lib/reporte";

const esperada = process.argv[2] ?? "America/Argentina/Buenos_Aires";
const debeFallarAlUsar = process.argv[3] === "falla";

console.log(`  import ok, ZONA = ${JSON.stringify(ZONA)}`);
if (ZONA !== esperada) {
  throw new Error(`ZONA deberia ser ${JSON.stringify(esperada)}, es ${JSON.stringify(ZONA)}`);
}

let fallo: string | null = null;
try {
  if (!JSON.stringify(diaLocal({} as never)).includes(esperada)) {
    throw new Error("diaLocal no interpolo la zona");
  }
} catch (e) {
  fallo = (e as Error).message;
}

if (debeFallarAlUsar) {
  if (!fallo) throw new Error("se esperaba que diaLocal rechazara esta zona, y no lo hizo");
  console.log(`  rechazada al USARLA (no al importar): ${fallo.slice(0, 70)}`);
} else {
  if (fallo) throw new Error(`diaLocal fallo con una zona valida: ${fallo}`);
  console.log("  uso ok (diaLocal interpola la zona)");
}
if (!esDimension("dia")) throw new Error("esDimension roto");
