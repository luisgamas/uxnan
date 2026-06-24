# Security Policy

Uxnan is a remote control plane for AI coding agents. It moves potentially
sensitive data (source code, agent output, approvals) and is built around an
**end-to-end encrypted** protocol (X25519 + Ed25519 + AES-256-GCM + HKDF-SHA256).
We take security seriously and appreciate responsible disclosure.

## Reporting a vulnerability

**Please do NOT open a public issue, PR, or Discussion for a security problem.**

Report it privately through GitHub Security Advisories:

➡️ https://github.com/luisgamas/uxnan/security/advisories/new

<!-- FOR-HUMAN: optionally add a security contact email here as a fallback,
     e.g. "or email security@yourdomain". Leave private-reporting as primary. -->

When reporting, please include (where possible):

- Which component is affected (`shared`, `bridge`, `relay`, `uxnandesktop`,
  `uxnanmobile`) and the version.
- A description of the issue and its impact.
- Steps to reproduce or a proof of concept.
- Operating system / platform.

We aim to acknowledge a report within a few days and to keep you updated on the
fix. This is an **alpha** project maintained in spare time, so timelines are
best-effort — but security reports are prioritized over everything else.

Please give us a reasonable window to release a fix before any public
disclosure. We're happy to credit you in the advisory unless you prefer to stay
anonymous.

## Supported versions

The project is in **alpha**. Only the **latest** published version of each
component receives security fixes; there are no backports to older alphas.

| Component | Supported |
| --------- | --------- |
| Latest released alpha (each component) | ✅ |
| Any older version | ❌ |

## Scope

In scope: the E2EE protocol and key handling, the bridge/relay transport, input
validation at system boundaries, secret storage, and the desktop/mobile clients.

Out of scope: vulnerabilities in third-party agent CLIs themselves (Claude Code,
Codex, OpenCode, Gemini, pi), and issues that require a already-compromised host.

## Our security ground rules

These are enforced in the codebase (see `AGENTS.md` → Security) and we expect
contributions to uphold them: no plaintext secrets, no secrets in logs/errors,
no disabling TLS verification, no `eval`, validate all boundary input, and never
modify the documented E2EE protocol with home-grown variants.
