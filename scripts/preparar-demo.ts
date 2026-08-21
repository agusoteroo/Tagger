/**
 * Prepara la app para mostrarla al cliente.
 *
 *   npm run demo:preparar
 *
 * Hace tres cosas que es fácil olvidarse y que importan cuando la URL es pública:
 *   1. Cambia los tres PINs por unos nuevos al azar y te los muestra.
 *   2. Deja producción de ejemplo cargada, así las pantallas no están vacías.
 *   3. Enciende MODO_DEMO en el .env.local para que salga el banner de prueba.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { sql } from "drizzle-orm";
import { cerrarConexion, db } from "../src/db";
import { migrar } from "../src/db/migrar";
import { etiquetas } from "../src/db/schema";
import { setPin, type Rol } from "../src/lib/auth";

const esWin = process.platform === "win32";
const npx = esWin ? "npx.cmd" : "npx";

/** PIN de 4 dígitos al azar, sin secuencias obvias ni todos iguales. */
function pinAlAzar(usados: Set<string>): string {
  for (;;) {
    const n = crypto.randomInt(1000, 10000).toString();
    if (usados.has(n)) continue;
    if (/^(\d)\1{3}$/.test(n)) continue; // 1111
    if ("0123456789".includes(n) || "9876543210".includes(n)) continue; // 1234 / 4321
    usados.add(n);
    return n;
  }
}

function ponerEnEnv(clave: string, valor: string) {
  const archivo = path.join(process.cwd(), ".env.local");
  let texto = fs.existsSync(archivo) ? fs.readFileSync(archivo, "utf8") : "";
  const linea = `${clave}=${valor}`;
  const re = new RegExp(`^${clave}=.*$`, "m");
  texto = re.test(texto) ? texto.replace(re, linea) : `${texto.replace(/\s*$/, "")}\n${linea}\n`;
  fs.writeFileSync(archivo, texto, "utf8");
}

async function main() {
  console.log("\nPreparando la demo...\n");

  // --- 1. Datos de ejemplo -------------------------------------------------
  await migrar();
  const [{ n: cuantas }] = await db.select({ n: sql<number>`count(*)::int` }).from(etiquetas);
  if (cuantas < 200) {
    console.log("  Generando producción de ejemplo...");
    execFileSync(npx, ["tsx", "scripts/seed-demo.ts"], { stdio: "inherit", shell: esWin });
  } else {
    console.log(`  Ya hay ${cuantas} etiquetas cargadas, no genero más.`);
  }

  // --- 2. PINs nuevos ------------------------------------------------------
  const usados = new Set<string>();
  const nuevos: Record<string, string> = {};
  for (const rol of ["jefe", "calidad", "admin"] as Exclude<Rol, "operario">[]) {
    const pin = pinAlAzar(usados);
    await setPin(rol, pin);
    nuevos[rol] = pin;
  }

  // --- 3. Modo demo --------------------------------------------------------
  ponerEnEnv("MODO_DEMO", "1");

  // --- 4. Dejarlos por escrito ---------------------------------------------
  // Los PINs se guardan HASHEADOS en la base: no hay forma de recuperarlos
  // después. Si solo los imprimiéramos en la terminal, cerrar la ventana te
  // deja afuera. Este archivo está en .gitignore.
  const archivo = path.join(process.cwd(), "PINS-DEMO.txt");
  const fecha = new Date().toISOString().slice(0, 16).replace("T", " ");
  fs.writeFileSync(
    archivo,
    [
      `PINs de la demo — generados el ${fecha}`,
      ``,
      `  Jefe de planta ....... ${nuevos.jefe}    (abrir y cerrar lotes)`,
      `  Calidad .............. ${nuevos.calidad}    (liberar y rechazar cajas)`,
      `  Administración ....... ${nuevos.admin}    (todo, incluido Configuración)`,
      ``,
      `Etiquetar NO pide PIN: el operario entra directo.`,
      ``,
      `Estos PINs se guardan hasheados en la base. Este archivo es la única`,
      `copia legible: si lo borrás, hay que volver a correr "npm run demo:preparar"`,
      `y se generan otros.`,
      ``,
      `No subir a git (ya está en .gitignore).`,
      ``,
    ].join("\n"),
    "utf8"
  );

  console.log("\n" + "=".repeat(58));
  console.log("  PINs NUEVOS — pasale estos al cliente");
  console.log("=".repeat(58));
  console.log(`  Jefe de planta ....... ${nuevos.jefe}`);
  console.log(`  Calidad .............. ${nuevos.calidad}`);
  console.log(`  Administración ....... ${nuevos.admin}`);
  console.log("=".repeat(58));
  console.log(`  Guardados también en:  PINS-DEMO.txt`);
  console.log("  (se guardan hasheados en la base: ese archivo es la única copia)");
  console.log("  Los de ejemplo (3690/2468/1357) ya NO funcionan.");
  console.log("  Etiquetar no pide PIN: el operario entra directo.\n");
  console.log("  Banner de prueba: ACTIVADO (MODO_DEMO=1 en .env.local)\n");
  console.log("  Ahora, en dos terminales:");
  console.log("    1)  npm run build  &&  npm start");
  console.log("    2)  cloudflared tunnel --url http://localhost:3000\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => cerrarConexion());
