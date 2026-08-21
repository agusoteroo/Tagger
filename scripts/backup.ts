/**
 * Backup consistente de la base, sin parar la app.
 *
 *   npm run backup                 -> deja el archivo en ./backups
 *   npm run backup -- /ruta/dir    -> lo deja donde le digas
 *
 * Por qué no `cp etiquetado.db`: con WAL activo, copiar el archivo a mano puede
 * agarrar un estado a medias (parte del commit vive en el -wal). `VACUUM INTO`
 * escribe una base nueva, completa y consistente, mientras la app sigue
 * escribiendo.
 *
 * En Fly esto corre dentro de la máquina:
 *   fly ssh console -C "node /app/scripts/backup.js /data/backups"
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const RETENER = 14; // días de backups locales que se conservan

function main() {
  const rel = process.env.DB_PATH ?? "data/etiquetado.db";
  const origen = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
  if (!fs.existsSync(origen)) {
    console.error(`No encuentro la base en ${origen}`);
    process.exit(1);
  }

  const destinoDir = process.argv[2] ?? path.join(process.cwd(), "backups");
  fs.mkdirSync(destinoDir, { recursive: true });

  const sello = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const destino = path.join(destinoDir, `etiquetado-${sello}.db`);

  // Solo lectura: un backup jamás debería poder modificar el original.
  const db = new Database(origen, { readonly: true });
  try {
    // VACUUM INTO no acepta parámetros bindeados, hay que interpolar. La ruta
    // la armamos nosotros (no viene de un usuario), pero escapamos las comillas
    // por si el directorio tiene alguna.
    db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }

  const tam = fs.statSync(destino).size;
  console.log(`Backup OK: ${destino}  (${(tam / 1024 / 1024).toFixed(2)} MB)`);

  // Verificación: un backup que no se puede abrir no es un backup.
  const check = new Database(destino, { readonly: true });
  try {
    const integridad = check.pragma("integrity_check", { simple: true });
    const n = (check.prepare("SELECT COUNT(*) n FROM etiquetas").get() as { n: number }).n;
    if (integridad !== "ok") {
      console.error(`El backup NO pasa integrity_check: ${integridad}`);
      process.exit(1);
    }
    console.log(`Verificado: integridad ok, ${n} etiquetas.`);
  } finally {
    check.close();
  }

  // Limpieza de los viejos.
  const limite = Date.now() - RETENER * 86_400_000;
  let borrados = 0;
  for (const f of fs.readdirSync(destinoDir)) {
    if (!f.startsWith("etiquetado-") || !f.endsWith(".db")) continue;
    const completo = path.join(destinoDir, f);
    if (fs.statSync(completo).mtimeMs < limite) {
      fs.unlinkSync(completo);
      borrados++;
    }
  }
  if (borrados) console.log(`Borrados ${borrados} backups de más de ${RETENER} días.`);
}

main();
