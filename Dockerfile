# syntax=docker/dockerfile:1

# ---- build: compile better-sqlite3, build the TypeScript and the SPA ----
FROM node:22-bookworm-slim AS build
# Toolchain in case better-sqlite3 has no prebuilt binary for this platform (e.g. arm64).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
# npm 10 (bundled with Node 22) runs install scripts, so better-sqlite3 is built
# here. package.json's `allowScripts` is what lets npm 12+ do the same.
RUN npm ci
COPY . .
RUN npm run build \
 && npm prune --omit=dev

# ---- runtime: dist/ (server + SPA in dist/client), migrations, prod node_modules ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Resolved as ../../../drizzle from dist/core/db, i.e. /app/drizzle.
COPY --from=build /app/drizzle ./drizzle
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node
EXPOSE 3000
# node is PID 1 and handles SIGTERM itself (graceful shutdown, 10 s cap).
CMD ["node", "dist/main.js"]
