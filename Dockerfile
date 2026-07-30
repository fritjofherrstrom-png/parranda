# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci --prefix frontend

COPY anywhere-render-decision.js ./
COPY frontend ./frontend
RUN npm run check:frontend && npm run build:frontend


FROM node:22-bookworm-slim AS runtime

ARG PARRANDA_BUILD_SHA=unknown

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8000 \
    PARRANDA_BUILD_SHA=${PARRANDA_BUILD_SHA}

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force \
    && mkdir -p /var/lib/parranda/source-cache \
    && chown -R node:node /var/lib/parranda

COPY --chown=node:node server.js ./
COPY --chown=node:node server ./server
COPY --chown=node:node config ./config
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node scripts/migrate-source-catalog.js ./scripts/migrate-source-catalog.js
COPY --chown=node:node scripts/review-source-profile.js ./scripts/review-source-profile.js
COPY --chown=node:node assets ./assets
COPY --chown=node:node vendor ./vendor
COPY --from=build --chown=node:node /app/frontend/dist ./frontend/dist
COPY --chown=node:node \
    index.html \
    landing.html \
    dogfood.html \
    styles.css \
    script.js \
    ux-pass1.js \
    planner-trust.js \
    manifest.webmanifest \
    sw.js \
    dogfood.js \
    dogfood-render.js \
    anywhere-render-decision.js \
    ./

USER node

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:8000/api/health').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
