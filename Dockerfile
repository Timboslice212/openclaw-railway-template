# syntax=docker/dockerfile:1

# Pin the official stable OpenClaw image. Release tags intentionally omit the
# leading "v" used by GitHub releases.
ARG OPENCLAW_VERSION=2026.9.2
FROM ghcr.io/openclaw/openclaw:${OPENCLAW_VERSION}

USER root
WORKDIR /opt/openclaw-railway

COPY --chown=node:node package.json ./package.json
COPY --chown=node:node src ./src

RUN chmod 755 /opt/openclaw-railway/src/healthcheck.mjs

ENV NODE_ENV=production \
    PORT=8080 \
    OPENCLAW_INTERNAL_GATEWAY_HOST=127.0.0.1 \
    OPENCLAW_INTERNAL_GATEWAY_PORT=18789 \
    OPENCLAW_STATE_DIR=/data/.openclaw \
    OPENCLAW_WORKSPACE_DIR=/data/workspace \
    XDG_CONFIG_HOME=/data/.config

EXPOSE 8080

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "/opt/openclaw-railway/src/healthcheck.mjs"]

CMD ["node", "/opt/openclaw-railway/src/server.mjs"]
