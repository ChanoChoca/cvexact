# syntax=docker/dockerfile:1

# Multi-stage build producing a minimal runtime image from Next's standalone
# output. `output: "standalone"` in next.config.ts is what makes this possible —
# without it the runner would need the full node_modules tree.

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# --- Dependencies -------------------------------------------------------------
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# --- Build --------------------------------------------------------------------
FROM base AS builder
WORKDIR /app

# Next inlinea las variables `NEXT_PUBLIC_*` en el bundle durante `next build`.
# `NEXT_PUBLIC_SOURCE_URL` no se lee del entorno del pod: si no se pasa acá, el
# enlace AGPL queda oculto para siempre, aunque el contenedor tenga la variable.
# Tiene que apuntar al tag o commit del código que se está construyendo:
#
#   docker build --build-arg NEXT_PUBLIC_SOURCE_URL=https://.../tree/<tag> ...
#
# Sólo vive en este stage. El runner no la necesita porque el valor ya está
# horneado en `.next/standalone`.
ARG NEXT_PUBLIC_SOURCE_URL
ENV NEXT_PUBLIC_SOURCE_URL=$NEXT_PUBLIC_SOURCE_URL

COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build

# --- Migrator -----------------------------------------------------------------
# The standalone runtime does not trace the drizzle CLI (nothing in server.js
# imports it), so `drizzle-kit migrate` cannot run from the runtime image. This
# target keeps full node_modules instead and exists only to be built and pushed
# as its own image:
#
#   docker build --target migrator -t registry.example.com/cvexact-migrate .
#
# It runs as a k8s initContainer (ver los CronJobs de tu despliegue) before the app,
# against el Postgres que proveas.
#
# This stage goes BEFORE `runner` on purpose: a build without --target produces
# the LAST stage in the file. With migrator last, `docker build -t
# registry.example.com/cvexact .` silently tagged the migrator as the app image, and the
# container ran `drizzle-kit migrate` and exited instead of serving.
FROM base AS migrator
WORKDIR /app
# postgresql-client trae `pg_dump`, que scripts/backup.mjs ejecuta. Los otros
# scripts hablan con la base por el driver `pg` y no lo necesitan; el binario está
# acá y no en `runner` porque la app nunca vuelca la base — sólo este stage, que
# es el que corren los CronJobs.
#
# La versión TIENE QUE SER >= la del servidor (el compose de ejemplo usa `postgres:18`).
# pg_dump puede volcar servidores más viejos que él, nunca más nuevos: contra un
# servidor 18, un pg_dump 17 aborta con "server version mismatch" y el backup
# falla todos los días sin que nadie mire el log del CronJob. Al subir la imagen
# de Postgres, subir también esta línea.
RUN apk add --no-cache postgresql18-client
COPY --from=deps /app/node_modules ./node_modules
COPY drizzle.config.ts ./
COPY lib/db ./lib/db
COPY scripts/migrate.mjs ./scripts/migrate.mjs
COPY scripts/prune.mjs ./scripts/prune.mjs
COPY scripts/backup.mjs ./scripts/backup.mjs
COPY scripts/prune-backups.mjs ./scripts/prune-backups.mjs
COPY scripts/ingest-jobs.mjs ./scripts/ingest-jobs.mjs
COPY scripts/ingest-jooble.mjs ./scripts/ingest-jooble.mjs
COPY scripts/ingest-ats.mjs ./scripts/ingest-ats.mjs
COPY scripts/jobs ./scripts/jobs
COPY scripts/send-job-alerts.mjs ./scripts/send-job-alerts.mjs
COPY scripts/tracker-cron.mjs ./scripts/tracker-cron.mjs

# Runs drizzle-orm's migrate() directly rather than `drizzle-kit migrate`:
# that CLI silently exits 1 with no error output on failure (upstream bug,
# see scripts/migrate.mjs).
CMD ["node", "scripts/migrate.mjs"]

# --- Runtime ------------------------------------------------------------------
# Last stage in the file, so it is what a plain `docker build .` produces.
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# server.js does not copy public/ or .next/static itself; both must be placed
# beside it or the app serves no assets and no self-hosted fonts.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Avisos y textos de las licencias de terceros que viajan con el binario
# (sharp/libvips es LGPL-3.0-or-later; ver THIRD_PARTY.md).
COPY --from=builder --chown=nextjs:nodejs /app/THIRD_PARTY_LICENSES ./THIRD_PARTY_LICENSES

COPY --from=builder --chown=nextjs:nodejs /app/lib/db/migrations ./lib/db/migrations
COPY --from=builder --chown=nextjs:nodejs /app/drizzle.config.ts ./drizzle.config.ts

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
