import { bandera, entero, texto, textoOpcional } from "@/lib/entorno";

/**
 * El bug de la variable definida pero vacia, en todas sus formas.
 *
 * Aparecio dos veces: TZ_PLANTA="" tumbo el build, y DB_MAX_CONEXIONES="" dejo
 * el pool en cero conexiones y colgo la funcion 300 segundos sin un error.
 */

let fallas = 0;
function chequear(que: string, real: unknown, esperado: unknown) {
  const ok = real === esperado;
  if (!ok) fallas++;
  console.log(`  ${ok ? "OK " : "MAL"}  ${que.padEnd(52)} ${JSON.stringify(real)}`);
}

function con(valor: string | undefined, fn: () => void) {
  const antes = process.env.PRUEBA;
  if (valor === undefined) delete process.env.PRUEBA;
  else process.env.PRUEBA = valor;
  try {
    fn();
  } finally {
    if (antes === undefined) delete process.env.PRUEBA;
    else process.env.PRUEBA = antes;
  }
}

console.log("--- texto(): el vacio cae al default ---");
con(undefined, () => chequear('sin definir', texto("PRUEBA", "def"), "def"));
con("", () => chequear('vacia -> default (con ?? daba "")', texto("PRUEBA", "def"), "def"));
con("   ", () => chequear("solo espacios -> default", texto("PRUEBA", "def"), "def"));
con(" hola ", () => chequear("recorta espacios", texto("PRUEBA", "def"), "hola"));

console.log("--- textoOpcional() ---");
con("", () => chequear("vacia -> null", textoOpcional("PRUEBA"), null));
con("x", () => chequear("con valor -> el valor", textoOpcional("PRUEBA"), "x"));

console.log("--- entero(): el caso que colgo la funcion ---");
con("", () => chequear('vacia -> default (Number("") daba 0)', entero("PRUEBA", 3, { min: 1, max: 20 }), 3));
con("0", () => chequear("cero -> default, NO un pool vacio", entero("PRUEBA", 3, { min: 1, max: 20 }), 3));
con("-5", () => chequear("negativo -> default", entero("PRUEBA", 3, { min: 1, max: 20 }), 3));
con("999", () => chequear("por encima del max -> default", entero("PRUEBA", 3, { min: 1, max: 20 }), 3));
con("hola", () => chequear("no numerico -> default", entero("PRUEBA", 3, { min: 1, max: 20 }), 3));
con("2.5", () => chequear("decimal -> default", entero("PRUEBA", 3, { min: 1, max: 20 }), 3));
con("  7  ", () => chequear("valido con espacios -> 7", entero("PRUEBA", 3, { min: 1, max: 20 }), 7));
con("1", () => chequear("el minimo es valido", entero("PRUEBA", 3, { min: 1, max: 20 }), 1));

console.log("--- bandera(): solo \"1\" prende ---");
con("1", () => chequear('"1" prende', bandera("PRUEBA"), true));
con(" 1 ", () => chequear('" 1 " prende (recorta)', bandera("PRUEBA"), true));
con("", () => chequear("vacia no prende", bandera("PRUEBA"), false));
con("0", () => chequear('"0" no prende', bandera("PRUEBA"), false));
con("true", () => chequear('"true" NO prende (a proposito)', bandera("PRUEBA"), false));

if (fallas > 0) {
  console.error(`\n${fallas} fallas`);
  process.exitCode = 1;
} else {
  console.log("\nTodo OK");
}
