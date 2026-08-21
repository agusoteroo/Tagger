/**
 * Arma un paquete portable para que otra persona lo pruebe en su PC.
 *
 *   npm run empaquetar
 *
 * Deja una carpeta (y un .zip) que se descomprime y se abre con doble clic:
 * no hay que instalar Node, ni npm install, ni compilar nada. Va node.exe
 * adentro, junto con el server ya compilado y una base con datos de ejemplo.
 *
 * Requisito del que lo recibe: Windows de 64 bits. Nada más.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const raiz = process.cwd();
const salida = path.join(raiz, "paquete", "ENPLAS-Etiquetado");
const esWin = process.platform === "win32";

function copiar(desde: string, hasta: string, obligatorio = true) {
  if (!fs.existsSync(desde)) {
    if (obligatorio) throw new Error(`Falta ${desde}. ¿Corriste "npm run build"?`);
    return false;
  }
  fs.mkdirSync(path.dirname(hasta), { recursive: true });
  fs.cpSync(desde, hasta, { recursive: true });
  return true;
}

function tamano(dir: string): number {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? tamano(p) : fs.statSync(p).size;
  }
  return total;
}

function main() {
  if (!esWin) {
    console.error("Este empaquetado es para Windows. En otro sistema hay que ajustar node.exe.");
    process.exit(1);
  }

  console.log("\n1. Compilando la app...");
  execFileSync("npm.cmd", ["run", "build"], { stdio: "inherit", shell: true });

  console.log("\n2. Armando la base con datos de ejemplo...");
  // Base limpia + catálogos + producción de ejemplo, así el que lo prueba ve
  // los dashboards con números en vez de pantallas vacías.
  const tmpDatos = path.join(raiz, "data");
  fs.rmSync(tmpDatos, { recursive: true, force: true });
  fs.mkdirSync(tmpDatos, { recursive: true });
  execFileSync("npx.cmd", ["tsx", "src/db/seed.ts"], { stdio: "inherit", shell: true });
  execFileSync("npx.cmd", ["tsx", "scripts/seed-demo.ts"], { stdio: "inherit", shell: true });

  console.log("\n3. Copiando archivos...");
  fs.rmSync(path.join(raiz, "paquete"), { recursive: true, force: true });
  fs.mkdirSync(salida, { recursive: true });

  // El build standalone trae su propio server.js y solo los módulos que usa.
  copiar(path.join(raiz, ".next", "standalone"), salida);
  copiar(path.join(raiz, ".next", "static"), path.join(salida, ".next", "static"));
  copiar(path.join(raiz, "public"), path.join(salida, "public"), false);

  // better-sqlite3 es nativo y va como external: el tracing de Next no siempre
  // se lleva el .node, así que se copia explícitamente.
  //
  // Es lo único que hace falta: la v13 trae los binarios precompilados de todas
  // las plataformas en prebuilds/ y su única dependencia (node-addon-api) es de
  // compilación, no de runtime. No hay que copiar `bindings` ni nada más.
  copiar(
    path.join(raiz, "node_modules", "better-sqlite3"),
    path.join(salida, "node_modules", "better-sqlite3")
  );

  // Migraciones: la app las aplica al arrancar.
  copiar(path.join(raiz, "drizzle"), path.join(salida, "drizzle"));

  // La base con los datos de ejemplo.
  copiar(path.join(tmpDatos, "etiquetado.db"), path.join(salida, "datos", "etiquetado.db"));

  // node.exe adentro: es lo que hace que no haya que instalar nada.
  const nodeExe = process.execPath;
  fs.copyFileSync(nodeExe, path.join(salida, "node.exe"));
  console.log(`   node.exe copiado desde ${nodeExe}`);

  console.log("\n4. Limpiando lo que no va...");

  // El build standalone de Next arrastra el proyecto entero, y ahí viajan cosas
  // que NO tienen que llegarle al cliente: el código fuente, los scripts, mis
  // notas internas (ENTREGA.md tiene la charla de propiedad del código) y
  // PINS-DEMO.txt. Incluso `paquete/` se copiaba dentro de sí mismo.
  //
  // Lista blanca y no lista negra, a propósito: si mañana aparece un archivo
  // nuevo en el proyecto, por defecto NO se filtra.
  const PERMITIDO = new Set([
    "server.js", // el server que genera Next
    ".next",
    "node_modules",
    "package.json",
    "drizzle", // migraciones, se aplican al arrancar
    "datos", // la base
    "public",
    "node.exe",
  ]);

  const sacados: string[] = [];
  for (const e of fs.readdirSync(salida)) {
    if (PERMITIDO.has(e)) continue;
    fs.rmSync(path.join(salida, e), { recursive: true, force: true });
    sacados.push(e);
  }
  if (sacados.length) console.log(`   sacados: ${sacados.join(", ")}`);

  // Verificación explícita: que no haya quedado fuente ni secretos.
  const PROHIBIDO = ["src", "scripts", "ENTREGA.md", "PINS-DEMO.txt", ".env.local", "Dockerfile"];
  const filtrados = PROHIBIDO.filter((f) => fs.existsSync(path.join(salida, f)));
  if (filtrados.length) {
    console.error(`\n   ERROR: quedaron archivos que no deben salir: ${filtrados.join(", ")}`);
    process.exit(1);
  }
  console.log("   verificado: sin código fuente ni secretos");

  console.log("\n5. Escribiendo el lanzador...");

  // El .bat: se para en su propia carpeta, arranca el server y abre el navegador.
  // `chcp 65001` para que los acentos no salgan roto en la consola.
  fs.writeFileSync(
    path.join(salida, "INICIAR.bat"),
    [
      "@echo off",
      "chcp 65001 >nul",
      "title ENPLAS - Etiquetado",
      "cd /d \"%~dp0\"",
      "",
      "set NODE_ENV=production",
      "set PORT=3000",
      "set HOSTNAME=127.0.0.1",
      "set DB_PATH=datos/etiquetado.db",
      "set TZ_OFFSET_HORAS=-3",
      "set MODO_DEMO=1",
      "set SEMBRAR_SI_VACIO=1",
      "",
      "echo ============================================================",
      "echo    ENPLAS - Etiquetado         (ambiente de prueba)",
      "echo ============================================================",
      "echo.",
      "echo   Abriendo en el navegador: http://localhost:3000",
      "echo.",
      "echo   PINs:",
      "echo     Jefe de planta ....... 3690",
      "echo     Calidad .............. 2468",
      "echo     Administracion ....... 1357",
      "echo.",
      "echo   Etiquetar no pide PIN.",
      "echo.",
      "echo   NO CIERRES ESTA VENTANA mientras uses la app.",
      "echo   Para terminar: cerra esta ventana.",
      "echo ============================================================",
      "echo.",
      "",
      "start \"\" http://localhost:3000",
      "node.exe server.js",
      "",
      "echo.",
      "echo El servidor se detuvo. Podes cerrar esta ventana.",
      "pause",
    ].join("\r\n"),
    "utf8"
  );

  fs.writeFileSync(
    path.join(salida, "LEEME.txt"),
    [
      "ENPLAS - Etiquetado  ·  Version de prueba",
      "==========================================",
      "",
      "COMO ARRANCARLO",
      "",
      "  1. Descomprimi toda la carpeta (no lo abras desde dentro del zip).",
      "  2. Doble clic en INICIAR.bat",
      "  3. Se abre solo en el navegador.",
      "",
      "  No hay que instalar nada. Windows 64 bits, y listo.",
      "",
      "  Si Windows muestra un aviso de seguridad al abrir el .bat, es porque",
      "  viene de internet: 'Mas informacion' -> 'Ejecutar de todas formas'.",
      "",
      "",
      "PINS",
      "",
      "  Etiquetar ................ no pide PIN",
      "  Jefe de planta ........... 3690     (abrir y cerrar lotes)",
      "  Calidad .................. 2468     (liberar y rechazar cajas)",
      "  Administracion ........... 1357     (todo, incluido Configuracion)",
      "",
      "",
      "QUE PROBAR",
      "",
      "  1. ETIQUETAR: elegi maquina, operario, turno y genera varias etiquetas",
      "     seguidas. Mira la barra de progreso del lote abajo del boton.",
      "",
      "  2. LOTES (PIN 3690): abri un lote con limite de 3 cajas. Volve a",
      "     Etiquetar y genera 3. En la tercera el lote se cierra solo.",
      "     Despues proba dejar uno EN COLA antes de que se llene: vas a ver",
      "     que arranca automatico y las cajas vuelven a empezar en #1.",
      "",
      "  3. CALIDAD (PIN 2468): libera algunas cajas y rechaza otras.",
      "",
      "  4. EFICIENCIA (PIN 1357): ya hay 12 dias de produccion de ejemplo.",
      "     Proba agrupar por operario, por turno, por dia. Filtra por fechas.",
      "",
      "  5. REPORTE: en Eficiencia, boton 'Generar reporte'. Baja un archivo",
      "     HTML que se abre en cualquier computadora, sin internet.",
      "",
      "  6. HISTORIAL (PIN 1357): filtra por operario, maquina, turno y fechas.",
      "     Proba el boton Exportar (sale un CSV que abre Excel).",
      "",
      "",
      "COSAS A TENER EN CUENTA",
      "",
      "  - Los datos son INVENTADOS. Operarios, maquinas y produccion son de",
      "    ejemplo. No sirve para etiquetar cajas reales.",
      "",
      "  - Todavia NO esta la impresion final. Hoy usa el dialogo de impresion",
      "    del navegador. Cuando este la impresora, va a salir directo y de un",
      "    solo toque, sin dialogo.",
      "",
      "  - Todo lo que hagas queda guardado en la carpeta 'datos'.",
      "",
      "  - Si queres EMPEZAR DE CERO: borra la carpeta 'datos' y volve a abrir",
      "    INICIAR.bat. Se rearma sola con las maquinas, productos y operarios,",
      "    pero SIN los 12 dias de produccion de ejemplo (Eficiencia e Historial",
      "    van a estar vacios hasta que etiquetes). No esta roto: es asi.",
      "",
      "  - Si queres VOLVER A LOS DATOS DE EJEMPLO: doble clic en",
      "    VOLVER-AL-EJEMPLO.bat. Te deja los 12 dias como venian.",
      "",
      "  - La pantalla se bloquea sola a los 5 minutos sin uso y vuelve a",
      "    Etiquetar. Es a proposito: en la planta la pantalla queda libre.",
      "",
    ].join("\r\n"),
    "utf8"
  );

  // El manual, para que lo tenga a mano.
  copiar(path.join(raiz, "MANUAL.md"), path.join(salida, "MANUAL.md"), false);

  // Copia de la base de ejemplo + un .bat para volver a ella.
  //
  // Si borra `datos` para empezar de cero, la app se rearma sola pero con los
  // catalogos vacios de produccion: Eficiencia e Historial quedan en cero y eso
  // parece que se rompio. Con esto puede ir y volver.
  copiar(
    path.join(tmpDatos, "etiquetado.db"),
    path.join(salida, "respaldo", "etiquetado-ejemplo.db")
  );

  fs.writeFileSync(
    path.join(salida, "VOLVER-AL-EJEMPLO.bat"),
    [
      "@echo off",
      "chcp 65001 >nul",
      "title Volver a los datos de ejemplo",
      "cd /d \"%~dp0\"",
      "",
      "echo ============================================================",
      "echo   Volver a los datos de ejemplo",
      "echo ============================================================",
      "echo.",
      "echo   Esto BORRA lo que hayas cargado y deja de nuevo los 12 dias",
      "echo   de produccion de ejemplo que venian originalmente.",
      "echo.",
      "set /p RTA=  Seguro? (S/N): ",
      "if /i not \"%RTA%\"==\"S\" goto :fin",
      "",
      "if not exist datos mkdir datos",
      "",
      // Los -wal y -shm quedan del WAL de SQLite: si sobreviven a la copia, la
      // base restaurada arranca con transacciones de la sesion anterior.
      //
      // Y sirven de deteccion: si no se pueden borrar es porque la app esta
      // abierta y tiene la base tomada. Sin este chequeo, el `copy` fallaba en
      // silencio y el usuario creia que habia restaurado.
      "if exist datos\\etiquetado.db-wal (",
      "  del datos\\etiquetado.db-wal >nul 2>nul",
      "  if exist datos\\etiquetado.db-wal goto :enuso",
      ")",
      "if exist datos\\etiquetado.db-shm del datos\\etiquetado.db-shm >nul 2>nul",
      "",
      "copy /y respaldo\\etiquetado-ejemplo.db datos\\etiquetado.db >nul",
      "if errorlevel 1 goto :enuso",
      "",
      "echo.",
      "echo   Listo. Abri INICIAR.bat.",
      "goto :fin",
      "",
      ":enuso",
      "echo.",
      "echo   NO SE PUDO: la app esta abierta y tiene la base tomada.",
      "echo.",
      "echo   Cerra la ventana de INICIAR.bat y volve a intentar.",
      "",
      ":fin",
      "echo.",
      "pause",
    ].join("\r\n"),
    "utf8"
  );

  const mb = tamano(salida) / 1024 / 1024;
  console.log(`\n6. Carpeta lista: ${mb.toFixed(0)} MB`);

  console.log("\n7. Comprimiendo...");
  const zip = path.join(raiz, "paquete", "ENPLAS-Etiquetado.zip");
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${salida}' -DestinationPath '${zip}' -CompressionLevel Optimal -Force`,
    ],
    { stdio: "inherit" }
  );

  const zipMb = fs.statSync(zip).size / 1024 / 1024;
  console.log(`\nListo.`);
  console.log(`  ${zip}`);
  console.log(`  ${zipMb.toFixed(0)} MB comprimido (${mb.toFixed(0)} MB descomprimido)`);
  console.log(`\n  Mandalo por Drive o WeTransfer: es muy grande para WhatsApp.`);
  console.log(`  El que lo recibe: descomprime y doble clic en INICIAR.bat\n`);
}

main();
