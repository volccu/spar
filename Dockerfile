# syntax=docker/dockerfile:1
#
# spår in one container: the web app and the spår server on one port, with
# every byte of state in /data.
#
#   docker build -t spar .
#   docker run -d --name spar -p 127.0.0.1:8080:8080 -v spar-data:/data spar
#
# One image serves any backend. SPAR_BACKEND=spar-server (the default) runs
# the server's own API and database; SPAR_BACKEND=supabase serves only the app
# and a /config.json pointing it at SPAR_SUPABASE_URL / SPAR_SUPABASE_KEY;
# SPAR_BACKEND=none serves only the app, which keeps notes on each device.
# docs/self-hosting.md is the guide, docs/server-api.md lists every setting.

ARG NODE_VERSION=22

# ---- build: the web app and the server bundle ---------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /src

# Dependencies first, so a source change does not reinstall them. No install
# scripts: nothing here needs a native module built (the server bundle leaves
# better-sqlite3 outside, and the runtime stage installs it), and the supabase
# CLI's postinstall would download a binary this image never runs.
COPY package.json package-lock.json ./
COPY web/package.json web/package-lock.json ./web/
RUN npm ci --ignore-scripts --no-audit --no-fund \
 && npm --prefix web ci --ignore-scripts --no-audit --no-fund

COPY . .

# A runtime-config build: the app asks /config.json which backend to use, so
# nothing about any one installation is baked in. The build variables are
# emptied on purpose, so a stray web/.env could not bake a project in either
# (.dockerignore keeps it out as well).
RUN VITE_RUNTIME_CONFIG=1 \
    VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= VITE_VAPID_PUBLIC_KEY= \
    npm run build:web \
 && npm run build:server

# ---- deps: the server's one native dependency, for the target's own libc ----
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
# better-sqlite3 downloads a prebuilt binary for linux/amd64 and linux/arm64;
# the toolchain is only the fallback for a platform without one, and stays in
# this stage.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ---- runtime ---------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim

# tini as PID 1: it passes docker stop's SIGTERM to the server (which closes
# its connections and the database, then exits 0) and reaps anything orphaned.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    SPAR_HOST=0.0.0.0 \
    SPAR_PORT=8080 \
    SPAR_DATA_DIR=/data \
    SPAR_WEB_DIR=/app/web

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /src/package.json /src/LICENSE ./
COPY --from=build /src/server/dist ./server/dist
COPY --from=build /src/web/dist ./web

# The data folder belongs to the unprivileged `node` user (uid 1000) the server
# runs as. A named volume takes this ownership on first use; a bind mount must
# be given it (chown 1000:1000).
RUN mkdir -p /data && chown node:node /data && chmod 700 /data
USER node
VOLUME ["/data"]
EXPOSE 8080

# /api/health answers in every backend mode and whatever SPAR_ALLOWED_HOSTS says.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.SPAR_PORT||process.env.PORT||8080,path:'/api/health',timeout:4000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1)).on('timeout',()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "server/dist/main.js"]
