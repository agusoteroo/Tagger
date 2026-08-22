import { sql } from "drizzle-orm";
import { cerrarConexion, db } from "@/db";
import { intentosPin } from "@/db/schema";
import {
  PIN_POR_DEFECTO,
  estaBloqueado,
  limpiarIntentos,
  pinsPorDefecto,
  registrarFallo,
  rolDePin,
  setPin,
} from "@/lib/auth";
import { requiereBaseDePrueba } from "./_requiere-postgres";

/**
 * PINs: deteccion de los de fabrica, y el freno contra fuerza bruta.
 *
 * Un aviso de seguridad que se equivoca es peor que no tenerlo: si dice "ya los
 * cambiaste" y no es cierto, nadie los cambia nunca.
 */

let fallas = 0;
function ok(nombre: string, cond: boolean, extra = "") {
  console.log(`  ${cond ? "OK   " : "FALLA"} ${nombre}${extra ? "  -> " + extra : ""}`);
  if (!cond) fallas++;
}

async function main() {
  requiereBaseDePrueba("test:auth");

  console.log("--- Detectar PINs de fábrica ---");
  for (const [rol, pin] of Object.entries(PIN_POR_DEFECTO)) {
    await setPin(rol as "jefe" | "calidad" | "admin", pin);
  }
  let deFabrica = await pinsPorDefecto();
  ok("los tres de fábrica se detectan", deFabrica.length === 3, deFabrica.join(", "));

  await setPin("admin", "918273");
  deFabrica = await pinsPorDefecto();
  ok("al cambiar admin, deja de avisar por admin", !deFabrica.includes("admin"), deFabrica.join(", "));
  ok("y sigue avisando por los otros dos", deFabrica.length === 2, deFabrica.join(", "));

  // El caso que importa: "cambiar" el PIN por el mismo de siempre.
  await setPin("admin", PIN_POR_DEFECTO.admin);
  deFabrica = await pinsPorDefecto();
  ok(
    "si lo 'cambia' al mismo de fábrica, vuelve a avisar",
    deFabrica.includes("admin"),
    deFabrica.join(", ")
  );

  console.log("\n--- El PIN identifica el rol ---");
  ok("PIN de jefe -> jefe", (await rolDePin(PIN_POR_DEFECTO.jefe)) === "jefe");
  ok("PIN inexistente -> null", (await rolDePin("000000")) === null);

  console.log("\n--- Freno por IP ---");
  await db.delete(intentosPin);
  const IP = "203.0.113.7";
  ok("con 0 fallos no bloquea", !(await estaBloqueado(IP)).bloqueado);
  for (let i = 0; i < 8; i++) await registrarFallo(IP);
  const trasOcho = await estaBloqueado(IP);
  ok("a los 8 fallos bloquea esa IP", trasOcho.bloqueado, `espera ${trasOcho.esperaSeg}s`);
  ok("otra IP sigue libre", !(await estaBloqueado("198.51.100.4")).bloqueado);
  await limpiarIntentos(IP);
  ok("limpiarIntentos la desbloquea", !(await estaBloqueado(IP)).bloqueado);

  console.log("\n--- Freno GLOBAL: rotar IPs no compra intentos ---");
  await db.delete(intentosPin);
  // 40 fallos repartidos en 40 IPs distintas: ninguna llega a 8, asi que el
  // limite por IP no ve nada. Es exactamente el ataque distribuido.
  for (let i = 0; i < 40; i++) await registrarFallo(`10.0.0.${i}`);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(intentosPin);
  ok("quedaron 40 fallos de 40 IPs distintas", n === 40, `n=${n}`);
  const nueva = await estaBloqueado("192.0.2.99");
  ok(
    "una IP NUEVA y sin fallos propios queda frenada igual",
    nueva.bloqueado,
    `espera ${nueva.esperaSeg}s`
  );

  await db.delete(intentosPin);
  ok("al limpiar, se libera", !(await estaBloqueado("192.0.2.99")).bloqueado);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Dejar los PINs de fabrica: es el estado que espera la demo, y los otros
    // tests asumen que estan puestos.
    try {
      for (const [rol, pin] of Object.entries(PIN_POR_DEFECTO)) {
        await setPin(rol as "jefe" | "calidad" | "admin", pin);
      }
      await db.delete(intentosPin);
    } catch (e) {
      console.error("no pude restaurar los PINs:", e);
    }
    console.log(fallas ? `\n${fallas} FALLAS\n` : "\nTodo OK\n");
    if (fallas) process.exitCode = 1;
    await cerrarConexion();
  });
