# Security Policy

## Supported versions

Security fixes are applied to the latest commit on `main`. The repository pins one reviewed OpenClaw release; older commits and downstream forks may not receive fixes.

## Reporting a vulnerability

Do **not** open a public issue for suspected vulnerabilities or exposed credentials. Use GitHub private vulnerability reporting for this repository when available. If it is unavailable, contact the repository owner privately through their verified GitHub profile and disclose only enough information to establish a secure reporting channel.

Include the affected commit, impact, realistic attack path, minimal reproduction, and suggested mitigation if known. Do not include real API keys, setup passwords, Gateway tokens, private Railway domains, or user data. Revoke exposed credentials immediately rather than waiting for a response.

## Deployment security baseline

- Set a long, unique `SETUP_PASSWORD` in Railway Template Composer before deployment.
- Keep the OpenClaw Gateway bound to `127.0.0.1:18789`.
- Expose only the wrapper through Railway HTTPS and `PORT`.
- Mount the persistent volume exactly at `/data` and restrict backup access.
- Keep provider and channel credentials in OpenClaw's Secret Store.
- Review upstream OpenClaw security notes before upgrading.
- Test fresh installs and existing-volume upgrades before publishing a template revision.

This policy covers the Railway integration. Vulnerabilities in OpenClaw itself should also be reported according to the upstream project's security policy.

