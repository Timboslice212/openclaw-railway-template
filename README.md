# OpenClaw on Railway

[![CI](https://github.com/Timboslice212/openclaw-railway-template/actions/workflows/ci.yml/badge.svg)](https://github.com/Timboslice212/openclaw-railway-template/actions/workflows/ci.yml)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-2026.9.2-7c8cff)](https://github.com/openclaw/openclaw/releases/tag/v2026.9.2)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A secure, version-pinned, guided deployment of the latest stable [OpenClaw](https://github.com/openclaw/openclaw) release on Railway.

> Tested upstream release: **OpenClaw 2026.9.2**

## What makes this template different

- A real browser first-run wizard: provider, model, optional channel, validation, and launch.
- No Railway terminal, copied Gateway token, request ID, or manual device-pairing step.
- Official OpenClaw one-time browser bootstrap for a durable administrator device credential.
- Live provider probe before setup is marked complete.
- Optional Telegram or Discord configuration and credential probe.
- A required `/data` volume; the wizard blocks instead of incorrectly calling ephemeral storage persistent.
- Official OpenClaw image pinned to a reviewed stable release, never a moving `latest` tag.
- Loopback-only Gateway behind a hardened HTTP/WebSocket proxy; OpenClaw's signed device identity protects the dashboard.
- Non-root application and Gateway processes after safe volume initialization.
- Explicit liveness and readiness endpoints, bounded commands, redacted diagnostics, and no secret echo.

## One-click user journey

1. Click **Deploy on Railway** from the published Railway Template.
2. Choose one strong `SETUP_PASSWORD` in Railway's deployment form.
3. Open the generated public domain and sign in with that password.
4. Select an AI provider and optionally override its default model.
5. Paste the provider API key and optionally connect Telegram or Discord.
6. The wizard applies the official non-interactive OpenClaw setup, validates the config, makes a small live provider probe, probes the optional channel, starts the Gateway, and waits for readiness.
7. Click **Launch secure dashboard**. OpenClaw issues a short-lived, single-use browser bootstrap and grants that browser its own durable administrator credential.

After first run, provider, model, agent, skill, and channel changes belong in the official OpenClaw dashboard. The setup page remains available for status and recovery diagnostics.

## Railway template resources

The published Railway Template snapshot creates these resources automatically:

| Resource | Configuration |
| --- | --- |
| Service | `openclaw`, built from this repository's Dockerfile |
| Volume | `openclaw-data`, mounted at `/data` |
| Public networking | Railway-generated HTTPS domain targeting port `8080` |
| Health check | `/healthz`, 300-second deployment timeout |
| Setup secret | `SETUP_PASSWORD`, required in the deploy form |

The repository also includes Railway's current Infrastructure-as-Code definition at `.railway/railway.ts`. The former `railway.toml` approach is intentionally not used because Railway no longer enables legacy Config-as-Code for new services and retires it on December 1, 2026.

## Supported first-run providers

| Provider | Credential |
| --- | --- |
| OpenAI | API key |
| Anthropic | API key |
| Google Gemini | API key |
| OpenRouter | API key |
| xAI (Grok) | API key |

OAuth and additional providers remain available after launch in OpenClaw. Telegram and Discord are the initial one-click channel options; more channel integrations remain available in the dashboard.

## Runtime paths

| Path | Purpose |
| --- | --- |
| `/setup` | Protected first-run and recovery interface |
| `/openclaw/` | Official OpenClaw Control UI through the wrapper |
| `/healthz` | Wrapper liveness for Railway deployment health |
| `/readyz` | Gateway readiness; returns 503 until the Gateway is ready |

OpenClaw state is stored below `/data`: configuration and credentials in `/data/.openclaw`, workspace files in `/data/workspace`, and supporting config/cache directories in `/data/.config` and `/data/.cache`.

## Development checks

The test suite uses a local mock Gateway and never calls an AI provider:

```bash
npm run check
npm test
```

The suite covers setup authentication, persistent-volume detection, first-run application, browser bootstrap rewriting, HTTP proxying, and WebSocket protection.

## Release policy

Upstream upgrades are deliberate. Update `OPENCLAW_VERSION` in `Dockerfile`, run the local suite, test a fresh Railway deployment, test an upgrade with an existing `/data` volume, and only then update the public template.

## Security notes

- Treat `SETUP_PASSWORD`, provider keys, channel tokens, and `/data` backups as administrator secrets.
- The setup password is collected by Railway before deployment. Setting it on an unauthenticated public first-run page would create a first-visitor account-takeover race.
- Provider credentials are submitted only over HTTPS, passed to the official onboarding command without being logged, and persisted in OpenClaw's private state.
- The generated Gateway token is stored with restrictive permissions and is never returned by the setup API or shown in the browser.
- The Gateway listens only on `127.0.0.1`; the public wrapper rebuilds trusted proxy headers. After first run, the official OpenClaw signed-device credential—not a recurring wrapper login—protects dashboard access.
- A Railway volume provides persistence, not an independent backup. Back up `/data` before major upgrades.

## License and trademarks

The Railway integration code in this repository is MIT licensed. OpenClaw is a separate upstream project and retains its own license and trademarks. This repository is not an official OpenClaw distribution.
