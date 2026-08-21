import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Fija la raiz del workspace.
   *
   * Sin esto, Next sube por el arbol de directorios buscando un lockfile,
   * encuentra el package-lock.json que hay en el home del usuario y lo toma
   * como raiz del proyecto.
   */
  turbopack: { root: path.resolve(__dirname) },

  /**
   * NO va `output: "standalone"`.
   *
   * Estaba de la epoca en que esto se iba a desplegar en Docker: standalone
   * empaqueta el server con solo lo que usa, para no copiar node_modules
   * entero a la imagen. En Vercel es contraproducente -- Vercel arma su propio
   * output y standalone le mueve de lugar los archivos de trazado. El deploy
   * fallaba en `onBuildComplete` con:
   *   ENOENT: .next/next-server.js.nft.json
   *
   * Tampoco va `serverExternalPackages: ["better-sqlite3"]`: ese paquete se
   * fue con la migracion a Postgres.
   *
   * Si algun dia esto vuelve a autoalojarse, standalone se vuelve a agregar.
   */
};

export default nextConfig;
