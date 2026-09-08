# Deployment Guide

This guide describes the intended Railway Template configuration. Do not publish the template until a fresh deployment has been tested and approved.

## Composer configuration

| Resource | Required configuration |
| --- | --- |
| Service | Build from this repository's `main` branch and `Dockerfile` |
| Volume | `openclaw-data`, mounted at `/data` |
| Public domain | Railway-generated HTTPS domain targeting the application `PORT` |
| Health check | `/healthz` with a 300-second deployment timeout |

### User-supplied variable

Railway Template Composer must show **1 variable value needed** before deployment.

| Setting | Value |
| --- | --- |
| Name | `SETUP_PASSWORD` |
| Required | Yes |
| Default | Empty |
| Description | Choose a strong password with at least 12 characters to unlock the secure setup dashboard. No username required. |

`.railway/railway.ts` uses `preserve()` for this variable, but that alone does not make the Composer field required. Configure it manually in Composer.

### Preconfigured variables

```text
OPENCLAW_STATE_DIR=/data/.openclaw
OPENCLAW_WORKSPACE_DIR=/data/workspace
OPENCLAW_INTERNAL_GATEWAY_HOST=127.0.0.1
OPENCLAW_INTERNAL_GATEWAY_PORT=18789
OPENCLAW_VOLUME_ROOT=/data
XDG_CONFIG_HOME=/data/.config
XDG_CACHE_HOME=/data/.cache
```

Do not ask users to supply these values. Do not expose the internal Gateway port publicly.

## Pre-publication test

1. Create an unpublished template revision from the intended commit.
2. Confirm Composer asks for exactly one value and uses the exact password description above.
3. Deploy into a disposable test project without deleting any existing project or volume.
4. Confirm the volume is mounted at `/data`.
5. Confirm Railway reports `/healthz` healthy and the service listens on the assigned `PORT`.
6. Open the public HTTPS domain and sign in with `SETUP_PASSWORD` without a username.
7. Configure a test provider and model through the wizard, or choose **Configure provider later in OpenClaw**.
8. Confirm provider validation when configured, Gateway startup, `/readyz`, and dashboard handoff succeed.
9. Redeploy the same service and confirm configuration and workspace data persist.
10. Back up the volume, test an upgrade separately, and record the result.

## Rollback

Keep a backup of `/data` and record the last known-good repository commit and OpenClaw image version. Application code can be rolled back to that commit, but state migrations may not be reversible. Follow upstream release guidance before attaching newer state to an older image.