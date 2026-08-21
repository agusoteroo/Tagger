import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * postgres.js va como externa, sin empaquetar.
   *
   * Es una libreria de Node pura: abre sockets, negocia TLS y usa crypto. Next
   * empaqueta el codigo de servidor, y empaquetada la conexion no se
   * establecia -- la peticion se colgaba hasta que Vercel la mataba por
   * tiempo, sin un solo error. Local no se notaba porque los scripts corren con
   * tsx, sin bundler.
   */
  serverExternalPackages: ["postgres"],

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
