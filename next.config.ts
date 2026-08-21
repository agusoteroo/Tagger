import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 es un modulo nativo: no se puede bundlear, va como external.
  serverExternalPackages: ["better-sqlite3"],

  // Fija la raiz del workspace. Sin esto, Next encuentra un package-lock.json
  // en el home del usuario y lo toma como raiz del proyecto.
  turbopack: { root: path.resolve(__dirname) },

  // Empaqueta el server con solo lo que usa: la imagen de Docker no tiene que
  // llevarse todo node_modules.
  output: "standalone",
};

export default nextConfig;
