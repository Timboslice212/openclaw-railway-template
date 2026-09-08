# Changelog

## 1.1.1 - 2026-09-08

- Restore OpenClaw's native credential flow to eliminate SecretRef runtime, audit, and readiness-transition failures during first-run setup.
- Replace raw OpenClaw diagnostic payloads with concise, secret-safe provider and channel errors.
- Keep the provider-deferred launch path introduced in 1.1.0.

## 1.1.0 - 2026-09-08

> Superseded by 1.1.1 before marketplace republication because OpenClaw's active runtime did not reliably materialize the generated SecretRefs during first-run validation.

- Store first-run provider credentials as SecretRefs from the start, preventing plaintext auth-profile residue during setup.
- Resolve temporary environment SecretRefs during audit and provider probes, then reload credentials from Secret Store for Gateway restarts and redeployments.
- Allow users to defer provider configuration and launch the OpenClaw dashboard without an API key.
- Clarify that `SETUP_PASSWORD` must contain at least 12 characters.

Notable changes to this Railway integration are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Professional project documentation, contribution guidance, security policy, support templates, and visual assets.
- Automated local Markdown-link validation in CI.

## [1.0.0] - 2026-09-08

### Added

- Secure browser-based first-run setup for supported providers.
- Persistent Railway volume layout under `/data`.
- Loopback-only OpenClaw Gateway behind an HTTP and WebSocket proxy.
- Browser bootstrap handoff and durable OpenClaw device credentials.
- Provider and optional channel validation with secret migration and audit.
- Health, readiness, diagnostics, non-root runtime, and mock-based tests.
- Railway Infrastructure-as-Code definition.

[Unreleased]: https://github.com/Timboslice212/openclaw-railway-template/compare/5c0a1533e558daf0e759e9b7d2a7031a0d82bf2e...HEAD
[1.0.0]: https://github.com/Timboslice212/openclaw-railway-template/commit/5c0a1533e558daf0e759e9b7d2a7031a0d82bf2e