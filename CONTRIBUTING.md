# Contributing

Thanks for helping improve OpenClaw on Railway. This repository maintains the Railway wrapper, deployment definition, setup experience, tests, and documentation. Changes to OpenClaw itself belong in the [upstream project](https://github.com/openclaw/openclaw).

## Before opening an issue

1. Check [Troubleshooting](docs/TROUBLESHOOTING.md) and existing issues.
2. Remove passwords, API keys, tokens, Gateway credentials, private domains, and private workspace content.
3. For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of creating a public issue.

## Development workflow

1. Fork the repository and create a focused branch.
2. Keep the official OpenClaw image pinned to a specific release.
3. Preserve the `/data` layout, loopback-only Gateway, Railway `PORT`, and `/healthz` behavior.
4. Add or update tests for behavioral changes.
5. Run `npm run verify`.
6. Open a pull request using the provided checklist.

## Pull-request expectations

- Explain the user-facing problem and the chosen solution.
- Keep unrelated refactors out of the change.
- Never commit real credentials, generated state, backups, or `.env` files.
- Update documentation and `CHANGELOG.md` when behavior changes.
- For OpenClaw upgrades, report both a fresh-deployment test and an existing-volume upgrade test.

By contributing, you agree that your contribution may be distributed under this repository's [MIT License](LICENSE).

