# ---------------------------------------------------------------------------
# ENPLAS · Etiquetado
#
# Un solo contenedor con la app y la base SQLite en un volumen persistente.
# No es serverless a proposito: SQLite necesita un filesystem real y UN solo
# proceso escribiendo, que es lo que hace segura la numeracion de cajas.
# ---------------------------------------------------------------------------

# --- Etapa 1: dependencias -------------------------------------------------
FROM node:22-slim AS deps
WORKDIR /app

# better-sqlite3 es nativo. Normalmente baja un prebuild, pero si no existe
# para esta plataforma tiene que poder compilarlo.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

# --- Etapa 2: build --------------------------------------------------------
FROM deps AS build
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- Etapa 3: solo dependencias de produccion ------------------------------
FROM deps AS prod-deps
WORKDIR /app
RUN npm prune --omit=dev

# --- Etapa 4: runtime ------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app

# sqlite3 para los backups (VACUUM INTO) y tini para manejar señales bien.
RUN apt-get update \
  && apt-get install -y --no-install-recommends sqlite3 tini ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# El volumen se monta acá. Fuera del volumen, la base se perdería en cada deploy.
ENV DB_PATH=/data/etiquetado.db

# El build standalone trae su propio server.js y solo los módulos que usa.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

# better-sqlite3 es external, así que el tracing de Next no siempre se lleva el
# binario .node. Se copia explícitamente para no depender de eso. Es lo único
# que hace falta: no tiene dependencias de runtime.
COPY --from=prod-deps /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3

# Los SQL de migración: se aplican al arrancar.
COPY --from=build /app/drizzle ./drizzle

RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
