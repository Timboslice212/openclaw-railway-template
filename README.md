# OpenClaw Railway Template

[![CI](https://github.com/Timboslice212/openclaw-railway-template/actions/workflows/ci.yml/badge.svg)](https://github.com/Timboslice212/openclaw-railway-template/actions/workflows/ci.yml)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-2026.9.2-7c8cff)](https://github.com/openclaw/openclaw/releases/tag/v2026.9.2)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A secure, low-maintenance Railway deployment for the official [OpenClaw](https://github.com/openclaw/openclaw) image. It adds a protected browser control center for setup, diagnostics, device pairing, and recovery without modifying OpenClaw itself.

> Current tested OpenClaw release: **2026.9.2**

## Why this template

- Uses the official version-pinned OpenClaw container instead of rebuilding the full source tree on Railway.
- Starts the public wrapper immediately, so configuration problems produce useful diagnostics instead of an unexplained Railway 502.
- Keeps the Gateway on container loopback and proxies HTTP/WebSocket traffic through the wrapper.
- Configures the wrapper as the Gateway's only trusted proxy and rebuilds forwarded-client headers instead of trusting browser input.
- Persists OpenClaw state, auth profiles, sessions, channel data, and workspace files on `/data`.
- Prepares Railway's root-owned volume, then drops permanently to the non-root `node` user before starting the web service or Gateway.
- Includes separate wrapper liveness (`/healthz`) and Gateway readiness (`/readyz`) probes.
- Never prints the Gateway token in deployment logs.

## Deploy on Railway

The public one-click button will be added after the clean deployment test is complete.

For the first test deployment:

1. Create a Railway project from this GitHub repository.
2. Add a persistent volume mounted at `/data`.
3. Add `SETUP_PASSWORD` with a strong random value.
4. Optionally add `OPENCLAW_GATEWAY_TOKEN` with a second strong random value. If omitted, the wrapper generates it once and stores it on the volume.
5. Generate a Railway public domain targeting port `8080`.
6. Open the domain. `/` redirects to the protected `/setup` control center.
7. Sign in on the branded setup page using `SETUP_PASSWORD`. The wrapper creates a secure HttpOnly session cookie; browser-native Basic Auth prompts are not used.
8. Copy the Gateway token, open `/openclaw`, and use that token when the official UI asks you to connect.
9. For a new browser profile, return to `/setup` and click **Approve browser** once, then reconnect. No Railway shell or CLI command is required.

## Required Railway settings

| Setting | Value |
| --- | --- |
| Volume mount | `/data` |
| Public networking target port | `8080` |
| Health check | `/healthz` |
| Restart policy | On failure, maximum 5 retries |

## Variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SETUP_PASSWORD` | Yes | none | Protects the control center and proxied dashboard HTTP routes |
| `OPENCLAW_GATEWAY_TOKEN` | Recommended | generated and persisted | OpenClaw Gateway admin token |
| `OPENCLAW_STATE_DIR` | No | `/data/.openclaw` | Persistent OpenClaw state |
| `OPENCLAW_WORKSPACE_DIR` | No | `/data/workspace` | Persistent agent workspace |
| `XDG_CONFIG_HOME` | No | `/data/.config` | Persistent auth-profile configuration |
| `XDG_CACHE_HOME` | No | `/data/.cache` | Writable OpenClaw and SQLite worker cache |
| `OPENCLAW_INTERNAL_GATEWAY_PORT` | No | `18789` | Private loopback Gateway port |
| `OPENCLAW_PUBLIC_ORIGIN` | No | `https://$RAILWAY_PUBLIC_DOMAIN` | Override the exact public origin, mainly for a custom domain |
| `OPENCLAW_VOLUME_ROOT` | No | `/data` | Railway volume root initialized before dropping privileges |
| `PORT` | Injected by Railway | `8080` | Public wrapper port |

Provider keys such as `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` may be stored as Railway variables. They are inherited by the Gateway process and are not returned by the control-center APIs.

## Routes

- `/setup` — password-protected control center.
- `/openclaw` — official OpenClaw Control UI through the wrapper.
- `/healthz` — wrapper liveness; safe for Railway health checks.
- `/readyz` — Gateway startup readiness; returns HTTP 503 until OpenClaw is ready.

## Local wrapper tests

The tests use a tiny mock Gateway and do not download OpenClaw:

```bash
npm run check
npm test
```

## Updating OpenClaw

Change `OPENCLAW_VERSION` in the Dockerfile only after reviewing the upstream stable release and testing a fresh Railway deployment plus a deployment with an existing `/data` volume. Do not point production templates at a moving `main` build.

## Security notes

- Treat both `SETUP_PASSWORD` and `OPENCLAW_GATEWAY_TOKEN` as administrator credentials.
- The Gateway only binds to `127.0.0.1` inside the container.
- Both HTTP and WebSocket access require the wrapper password; Basic credentials are stripped before proxying to OpenClaw.
- Interactive browser access uses a 12-hour HttpOnly, Secure, SameSite session cookie derived from `SETUP_PASSWORD`, preventing recurring browser sign-in dialogs. Basic credentials remain accepted for scripted diagnostics but are never forwarded upstream.
- The Railway public origin is registered automatically in OpenClaw's exact Control UI origin allowlist. Set `OPENCLAW_PUBLIC_ORIGIN` when using a custom domain.
- Setup APIs expose only a fixed allowlist of commands; there is no browser shell.
- Back up `/data` before upgrading or changing configuration.
- A Railway volume is persistent storage, not an independent backup.

## License

The integration code in this repository is MIT licensed. OpenClaw is a separate upstream project and retains its own license and trademarks.
