import { sql } from "drizzle-orm";
import { cerrarConexion, db } from "@/db";
import { auditoria, etiquetas, intentosPin, lotes, maquinas } from "@/db/schema";

/**
 * Borra los datos de PRODUCCION (etiquetas, lotes, auditoria) y deja los
 * catalogos.
 *
 * Por que existe: las suites corren contra DATABASE_URL, y mientras eso apunto a
 * la Supabase de produccion dejaron 168 etiquetas de prueba y un lote con limite
 * 1.000.000. Eso no puede quedar en la base que el cliente va a mirar.
 *
 * Que NO borra, a proposito: frascos, operarios, turnos, maquinas y la
 * configuracion (incluidos los PINs). Son configuracion, no produccion, y
 * borrarlos dejaria la app inservible hasta cargar los catalogos de nuevo.
 * Para vaciar TODO, incluido el esquema, esta `npm run db:reset`.
 *
 * Pide confirmacion explicita: es destructivo y no se puede deshacer.
 *
 *   CONFIRMO=si npm run db:limpiar
 */

async function contar() {
  const [r] = await db
    .select({
      etiquetas: sql<number>`(select count(*)::int from ${etiquetas})`,
      lotes: sql<number>`(select count(*)::int from ${lotes})`,
      auditoria: sql<number>`(select count(*)::int from ${auditoria})`,
      intentos: sql<number>`(select count(*)::int from ${intentosPin})`,
      frascos: sql<number>`(select count(*)::int from frascos)`,
      operarios: sql<number>`(select count(*)::int from operarios)`,
      maquinas: sql<number>`(select count(*)::int from ${maquinas})`,
    })
    .from(sql`(select 1) as x`);
  return r!;
}

function mostrar(titulo: string, c: Awaited<ReturnType<typeof contar>>) {
  console.log(`\n${titulo}`);
  console.log(`  etiquetas ${String(c.etiquetas).padStart(6)}   <- se borra`);
  console.log(`  lotes     ${String(c.lotes).padStart(6)}   <- se borra`);
  console.log(`  auditoria ${String(c.auditoria).padStart(6)}   <- se borra`);
  console.log(`  intentos  ${String(c.intentos).padStart(6)}   <- se borra`);
  console.log(`  frascos   ${String(c.frascos).padStart(6)}      se mantiene`);
  console.log(`  operarios ${String(c.operarios).padStart(6)}      se mantiene`);
  console.log(`  maquinas  ${String(c.maquinas).padStart(6)}      se mantiene`);
}

async function main() {
  const destino = (process.env.DATABASE_URL ?? "(pglite local)").replace(
    /:\/\/([^:]+):[^@]+@/,
    "://$1:***@"
  );
  console.log(`destino: ${destino}`);

  const antes = await contar();
  mostrar("ANTES:", antes);

  if (process.env.CONFIRMO !== "si") {
    console.log(
      "\nNo se borro nada. Esto es destructivo y no se puede deshacer.\n" +
        "Si es lo que querés:\n\n    CONFIRMO=si npm run db:limpiar\n"
    );
    return;
  }

  // En una transaccion: si algo falla, no queda a medias.
  //
  // El orden importa por las claves foraneas. maquinas.lote_actual_id apunta a
  // un lote, asi que primero hay que soltar esa referencia; si no, el delete de
  // lotes falla o deja una maquina apuntando a un lote que ya no existe.
  await db.transaction(async (tx) => {
    await tx.update(maquinas).set({ loteActualId: null });
    await tx.delete(etiquetas);
    await tx.delete(lotes);
    await tx.delete(auditoria);
    await tx.delete(intentosPin);

    // Reiniciar las secuencias: si no, la proxima etiqueta seria la id 1120 y
    // los ids arrancarian con un hueco raro en una base que se supone limpia.
    for (const t of ["etiquetas", "lotes", "auditoria", "intentos_pin"]) {
      await tx.execute(sql.raw(`alter sequence if exists ${t}_id_seq restart with 1`));
    }
  });

  const despues = await contar();
  mostrar("DESPUES:", despues);

  const limpio =
    despues.etiquetas === 0 &&
    despues.lotes === 0 &&
    despues.auditoria === 0 &&
    despues.intentos === 0;
  const catalogos = despues.frascos > 0 && despues.operarios > 0 && despues.maquinas > 0;

  console.log(
    `\n${limpio ? "OK " : "MAL"} produccion vacia` +
      `\n${catalogos ? "OK " : "MAL"} catalogos intactos`
  );
  if (!limpio || !catalogos) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("FALLO:", e);
    process.exitCode = 1;
  })
  .finally(() => cerrarConexion());
