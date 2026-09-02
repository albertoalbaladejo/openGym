FROM node:22-alpine

ARG VERSION=dev
ARG VCS_REF=dev
ARG BUILD_DATE=unknown

LABEL maintainer="Duarte Santos https://gitlab.com/DuarteSantos8" \
    org.opencontainers.image.title="opengym-api" \
    org.opencontainers.image.description="Backend for Self-hosted gym & body-weight tracker — plan routines, log workouts (supersets & cardio too), track your weight and progress, passkey login. Your data, your server." \
    org.opencontainers.image.source="https://gitlab.com/DuarteSantos8/opengym" \
    org.opencontainers.image.url="https://gitlab.com/DuarteSantos8/opengym/container_registry" \
    org.opencontainers.image.documentation="https://gitlab.com/DuarteSantos8/opengym#readme" \
    org.opencontainers.image.licenses="AGPL-3.0-or-later" \
    org.opencontainers.image.version=$VERSION \
    org.opencontainers.image.revision=$VCS_REF \
    org.opencontainers.image.created=$BUILD_DATE

# Build context is the REPOSITORY ROOT, not ./api (see docker-compose.yml).
# The import endpoint reuses the app's own training logic — the exercise catalogue, the
# name matcher and normalizeRepRange — by importing frontend/src/lib as plain Node ESM,
# the same way mcp/ does. Reimplementing those rules in the API would give two sources of
# truth for what a plan means. Nothing under frontend/src/lib that the API touches is
# Vite-specific, and it pulls in no dependencies of its own.
WORKDIR /app
COPY api/package.json api/package-lock.json* ./api/
RUN cd api && npm install --omit=dev && npm cache clean --force
COPY api/server.js api/push-messages.js api/verify-error.js ./api/
COPY api/import-plan.js api/exercise-resolve.js api/exercise-aliases.js ./api/
COPY frontend/src/lib ./frontend/src/lib

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000
CMD ["node", "api/server.js"]

HEALTHCHECK --interval=5m \
            --timeout=5s \
            --retries=3 \
            CMD wget --spider -q "http://127.0.0.1:${PORT}/api/health" || exit 1
