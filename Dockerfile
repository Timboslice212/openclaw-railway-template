# syntax=docker/dockerfile:1

# Pin the official stable OpenClaw image. Release tags intentionally omit the
# leading "v" used by GitHub releases.
ARG OPENCLAW_VERSION=2026.9.2
FROM ghcr.io/openclaw/openclaw:${OPENCLAW_VERSION}

USER root
WORKDIR /opt/openclaw-railway

COPY --chown=node:node package.json ./package.json
COPY --chown=node:node src ./src

RUN chmod 755 /opt/openclaw-railway/src/healthcheck.mjs \
    /opt/openclaw-railway/src/launcher.mjs

ENV NODE_ENV=production \
    HOME=/home/node \
    PORT=8080 \
    OPENCLAW_INTERNAL_GATEWAY_HOST=127.0.0.1 \
    OPENCLAW_INTERNAL_GATEWAY_PORT=18789 \
    OPENCLAW_VOLUME_ROOT=/data \
    OPENCLAW_STATE_DIR=/data/.openclaw \
    OPENCLAW_WORKSPACE_DIR=/data/workspace \
    XDG_CONFIG_HOME=/data/.config \
    XDG_CACHE_HOME=/data/.cache

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "/opt/openclaw-railway/src/healthcheck.mjs"]

# Railway mounts fresh volumes as root. The launcher prepares only the required
# directories, then permanently drops to uid/gid 1000 before starting the app.
USER root
CMD ["node", "/opt/openclaw-railway/src/launcher.mjs"]
