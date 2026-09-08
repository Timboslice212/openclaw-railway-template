# Troubleshooting

Use the protected `/setup` page first. Its diagnostics are designed for Railway containers and redact known secrets. Never paste unredacted credentials into an issue.

## Deployment health check fails

- Confirm the Railway health-check path is `/healthz`.
- Confirm the application uses Railway's assigned `PORT`.
- Review the earliest startup log for filesystem permission or image-pull errors.
- Confirm the pinned OpenClaw image tag in `Dockerfile` exists.

## Setup reports missing persistent storage

The wizard intentionally blocks configuration unless Railway reports a volume at `/data`.

- Attach `openclaw-data` to the service at exactly `/data`.
- Keep every preconfigured storage path under `/data`.
- Redeploy, then reopen `/setup`.

## Cannot sign in

- Use the exact `SETUP_PASSWORD`; there is no username.
- Check for accidental leading or trailing spaces.
- Wait briefly after repeated failures because attempts are throttled.
- When rotating the password, redeploy and keep the existing volume attached.

## Provider validation fails

- Confirm the selected provider matches the API key.
- Verify that the key is active and can use the selected model.
- Leave the model field empty to test the provider default.
- Check billing, quota, regional access, and provider incidents.
- Revoke any key that appeared in logs or screenshots.

## Gateway or dashboard is not ready

- Request `/readyz`; HTTP 503 means the wrapper is alive but the Gateway is not ready.
- Run **Container status** from `/setup`.
- Confirm the Gateway remains at `127.0.0.1:18789` and is not public.
- Run the OpenClaw Doctor diagnostic.
- Do not manually paste Gateway tokens into URLs.

## A channel sends a pairing code

This is OpenClaw's normal DM access protection, not a deployment failure.

1. Open the OpenClaw dashboard from the completed `/setup` page.
2. Go to **Settings → Channels → DM access requests**.
3. Review the channel, account, and sender, then select **Approve**.
4. Send the bot a new message after approval.

No terminal or Railway shell is required. Pairing grants direct-message access only; group access is configured separately. If the request has expired, message the bot again to create a new request.

## Data appears missing

- Confirm the original volume is attached to the same service at `/data`.
- Confirm state and workspace variables still point below `/data`.
- Check that a new service or environment was not created without the original volume.
- Preserve the current volume before restoring a backup.

## Safe diagnostics

Include the repository commit, pinned OpenClaw version, failing endpoint and status code, sanitized Railway logs, and failure stage. Remove passwords, provider keys, channel tokens, Gateway tokens, cookies, bootstrap fragments, domains, and private workspace content.
