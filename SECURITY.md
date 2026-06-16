# Security Policy

Sveltry is an open-source, self-hosted, Sentry-compatible error tracker. We take
the security of the project and of the deployments it powers seriously. This
document explains which versions we support, how to report a vulnerability
privately, and the parts of the system that are in scope for security review.

Sveltry is not affiliated with Sentry or Functional Software. It implements a
compatible subset of the Sentry ingestion wire protocol.

## Supported versions

Security fixes are provided for the latest minor release line. Older lines do
not receive backported fixes; upgrade to a supported version to stay protected.

| Version | Supported          |
| ------- | ------------------ |
| 0.9.x   | Yes                |
| < 0.9   | No                 |

## Reporting a vulnerability

Please report security issues privately. Do NOT open a public GitHub issue, pull
request, or discussion for a suspected vulnerability, and do not disclose details
publicly until a fix has been released and coordinated.

Use either channel:

- GitHub Security Advisories (preferred): open a private report at
  https://github.com/aihxp/sveltry/security/advisories/new
- Email: hprincivil@gmail.com

If you need to send sensitive details by email, mention that you would like an
encrypted channel and we will arrange one.

### What to include

A good report helps us reproduce and fix the issue quickly. Where possible,
include:

- A clear description of the vulnerability and its impact.
- The affected component (for example: ingest endpoint, JWT/JWKS verification,
  multi-tenant scoping, PII scrubbing, rate limiting, a specific package such as
  `@sveltry/protocol` or the dashboard).
- The version, commit, or deployment configuration you tested against.
- Step-by-step reproduction instructions, a proof-of-concept, or a minimal test
  case (for example, a crafted Sentry envelope or DSN).
- The expected versus actual behavior.
- Any logs, stack traces, or screenshots that do not themselves leak secrets.

Please redact real credentials (admin keys, instance secrets, DSNs, JWTs) from
anything you send us.

### Response timeline

- Acknowledgement: we aim to acknowledge your report within a few days.
- Assessment: we will validate the issue, determine severity and affected
  versions, and keep you updated on progress.
- Fix and disclosure: we will coordinate a fix, prepare a release, and agree a
  disclosure date with you. We publish an advisory once a fix is available.

These are good-faith targets for a small open-source project, not a contractual
SLA.

## Security model and scope

Sveltry's trust boundaries and the areas we consider most security-sensitive:

- DSN and ingest authentication. The ingest action validates the
  `(publicId, publicKey)` pair from the `X-Sentry-Auth` header or query string
  against `projectKeys` before accepting any event. A bad or missing key returns
  HTTP 401. Bypassing per-key validation, or accepting events for a project
  without a valid key, is in scope.
- Multi-tenant data isolation. Every dashboard query calls `requireOrg(ctx)`,
  which reads `activeOrganizationId` from the verified identity and scopes all
  reads and writes by `organizationId`. Any path that lets one organization read
  or modify another organization's issues, events, projects, keys, or alerts is
  a high-severity issue.
- The auth JWT/JWKS boundary. Better Auth runs as the `@convex-dev/better-auth`
  component on Convex and issues RS256 JWTs. Convex serves the JWKS at
  `{CONVEX_SITE_URL}/api/auth/convex/jwks` and verifies tokens statelessly via a
  Custom JWT provider (audience `convex`, issuer = `SITE_URL`, RS256). Token
  forgery, signature-verification bypass, audience or issuer confusion, and
  JWKS-fetch attacks are in scope.
- PII scrubbing at ingest. When enabled for a project, sensitive data is scrubbed
  before events are persisted. Failures that store data the scrubber should have
  removed are in scope.
- Per-key rate limiting. The optional fixed-window per-key limit protects against
  ingest abuse. Bypasses that defeat throttling are in scope.
- Outbound request safety (SSRF). Every outbound request the server makes on a
  user's behalf (issue-lifecycle webhooks, metric/usage alert channels, uptime
  probes, issue-tracker integrations) goes through `safeFetch`
  (`apps/backend/convex/lib/net.ts`): a literal host/scheme guard plus a
  DoH-resolved-IP check that defeats DNS rebinding, both re-applied on every
  redirect hop, and a non-GET body is never replayed across a 301/302/303. Cloud
  metadata and link-local addresses are blocked; RFC1918 and loopback are
  intentionally reachable because a self-hoster's webhook/alert target is often on
  a private network (so that allowance is by design, not a gap). The DoH resolver
  is operator-tunable via `SSRF_DOH_RESOLVER` (see `docs/SELF_HOSTING.md`). Any
  way to make the server fetch a blocked target, or to slip a blocked host past
  the per-hop re-validation, is in scope.
- Root credentials. The Convex admin key and the `INSTANCE_SECRET` are root
  credentials for a deployment. They must never be committed to the repository or
  shared. Generate the admin key with
  `docker compose exec backend ./generate_admin_key.sh` and store both in your
  environment, not in source control. Reports of credentials leaking through the
  code, build output, or logs are in scope.

### Out of scope: self-hosted deployment hardening

Sveltry is self-hosted, so operators own the security of their own
infrastructure. The following are your responsibility and are generally out of
scope for this policy unless the issue is caused by a defect in Sveltry itself:

- Terminating TLS in front of the dashboard and the Convex `.site` ingest origin.
- Network segmentation and firewalling between Postgres, the Convex backend, and
  the public internet.
- Securing Postgres (strong credentials, access control, backups, and TLS for
  managed databases; `DO_NOT_REQUIRE_SSL=1` is for local non-TLS use only).
- Restricting access to the Convex admin dashboard (default port 6791), which is
  an administrative surface and should never be exposed publicly.
- Keeping the host OS, container images, and dependencies patched, and rotating
  the admin key and instance secret as needed.

## Responsible disclosure

We support coordinated, responsible disclosure. If you report a valid issue
privately and give us reasonable time to fix it before going public, we will work
with you on timing and we will credit you in the advisory and release notes unless
you ask to remain anonymous. We will not pursue legal action against good-faith
research that respects user privacy, avoids data destruction, and does not degrade
service for others.

Thank you for helping keep Sveltry and its users safe.
