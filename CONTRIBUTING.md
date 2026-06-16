# Contributing to Sveltry

Thanks for your interest in Sveltry, an open-source, self-hosted, Sentry-compatible
error tracker. Whether you are fixing a bug, tightening wire-protocol compatibility,
or improving docs, contributions are welcome. This guide walks you through getting set
up, the project layout, local development, and the conventions we follow.

Sveltry is licensed Apache-2.0 and is not affiliated with Sentry or Functional
Software. It implements a compatible subset of the Sentry ingestion wire protocol so
that unmodified official `@sentry/*` SDKs can report to it.

## Prerequisites

- Bun 1.3+ (1.3.11 is the pinned version). Bun runs the workspaces, scripts, and tests.
- Docker (with Compose) to run the local infrastructure: Postgres, the self-hosted
  Convex backend, and the Convex dashboard.
- openssl, used by the setup script to generate local secrets.

## Getting set up

```bash
git clone https://github.com/aihxp/sveltry.git
cd sveltry
bun install
./scripts/setup.sh
```

`bun install` installs all workspace dependencies via the Bun catalog. `./scripts/setup.sh`
is the one-command local setup: it prepares env files, starts the infra containers, and
gets the deployment ready for development.

## Monorepo layout

Sveltry is a Bun workspaces monorepo. Here is where things live:

- `apps/dashboard/` SvelteKit 2 + Svelte 5 (runes) + Tailwind CSS v4 + shadcn-svelte,
  with Better Auth for identity and multi-tenancy.
- `apps/backend/` the self-hosted Convex backend. Functions live in `apps/backend/convex/`
  (schema, ingest, http routes, alerts, crons, auth config).
- `packages/protocol/` `@sveltry/protocol`: DSN parse, envelope parser, auth extract,
  decompress, normalize, fingerprint (SHA-1), ids, ratelimit, responses. This is the
  compatibility-critical core.
- `packages/types/` `@sveltry/types`: Sentry payload and domain types.
- `packages/sdk/` `@aihxp/sveltry-sdk`: helpers that point Sentry SDKs at Sveltry
  (DSN builder, recommended Sentry options, tunnel handler). Published to GitHub Packages.
- `infra/` `docker-compose.yml` (Postgres 17 + Convex backend + Convex dashboard),
  `Caddyfile`, `postgres/init.sql`, and `.env.example`.
- `scripts/setup.sh` the local setup entry point.

## Local development

Run the pieces you need in separate terminals:

```bash
bun run infra:up        # start Postgres + Convex backend + Convex dashboard
bun run dev:backend     # convex dev: pushes functions, runs codegen, watches
bun run dev:dashboard   # the SvelteKit app on http://localhost:5173
```

When you are done:

```bash
bun run infra:down      # stop the infra containers
bun run infra:logs      # tail container logs while debugging
```

Default ports: SvelteKit dev `5173`, Convex client/API (.cloud) `3210`, Convex HTTP
actions and ingest (.site) `3211`, Convex admin dashboard `6791`, Postgres `5432`.

## Running checks before a PR

Please run all of these locally before opening a pull request:

```bash
bun run --filter '@sveltry/protocol' test   # protocol unit tests (must all pass)
bun run check                               # type and Svelte checks across the repo
bun run build                               # full build
bunx prettier --check .                     # formatting
```

If `prettier --check` reports issues, run `bunx prettier --write .` to fix them.

## Testing philosophy

The `packages/protocol` package is the compatibility-critical core. It is what lets
unmodified `@sentry/*` SDKs report to Sveltry, so its behavior must stay exact and
predictable. It is unit-tested with `bun test` (one test file per source module); the
full protocol suite must pass before a change lands.

For any wire-protocol change (DSN parsing, envelope parsing, auth extraction,
decompression, normalization, fingerprinting, rate limiting, or response shaping) you
must add or update tests in `packages/protocol`. A change that alters how a Sentry
payload is parsed or grouped without a corresponding test will not be accepted. Treat
the test suite as the spec for compatibility.

## Adding a Convex function

Convex functions live in `apps/backend/convex/`. The dashboard talks to the backend
through a generated typed API, so a new or changed function must be deployed so that
codegen regenerates that API. With `bun run dev:backend` (`convex dev`) running, saving a
function file pushes it and regenerates `apps/backend/convex/_generated`.

Note that `apps/backend/convex/_generated` is committed to the repo. After adding or
changing a function, make sure the regenerated `_generated` output is included in your
commit so the dashboard's generated API stays in sync for everyone else.

If your function reads tenant-scoped data, follow the existing pattern: queries call
`requireOrg(ctx)` and scope all data by `organizationId`. Add or adjust schema tables
and indexes in `apps/backend/convex/schema.ts` as needed.

## Changesets for the published SDK

`@aihxp/sveltry-sdk` is published to GitHub Packages. If your change affects the SDK,
record a release with a changeset:

```bash
bunx changeset
```

Pick the appropriate semver bump and write a short, user-facing summary. Commit the
generated changeset file along with your change. Changes that do not touch the published
SDK do not need a changeset.

## Commit and PR conventions

- Commits follow Conventional Commits, for example `fix(protocol): tolerate empty
  Content-Type` or `feat(dashboard): add issue search`.
- Fill out the PR template completely and describe what changed and why.
- Link the relevant issue from your PR (for example `Closes #123`).
- Keep PRs focused. Smaller, single-purpose PRs are easier to review and merge.

## Code style

We use Prettier for formatting; run `bunx prettier --check .` before pushing.

Strict writing rules, enforced everywhere (code, comments, docs, markdown, PR
descriptions, and commit messages):

- Do not use em dashes or en dashes anywhere. Use commas, colons, parentheses, or two
  separate sentences instead.
- Use a plain hyphen `-` only for compound words and numeric ranges (for example
  `pages 10-15`).
- Do not use emojis anywhere. Where a visual marker is genuinely needed in the UI, use a
  real icon (the project uses `@lucide/svelte`) or an inline SVG, never an emoji.

These rules override any prior convention and apply to every file you write or edit.

## Reporting bugs and requesting features

Please open an issue using the provided issue templates:

- Bug report: include reproduction steps, expected versus actual behavior, the Sentry
  SDK and version involved (if relevant), and any error output. Wire-protocol issues are
  especially helpful when you can attach the raw envelope or the failing request.
- Feature request: describe the problem you are trying to solve and the outcome you want.

The Sentry envelope item types (event, transaction, session, attachment, replay,
profile, check-in, feedback) are parsed and persisted, and email alert delivery is wired
over SMTP. The remaining known gaps are narrow: client reports are accepted but not yet
surfaced in the UI, and minidump payloads are tolerated but not decoded (see
`docs/SENTRY_COMPATIBILITY.md` "Known limitations"). Please check existing issues before
filing a new one for these.

## Code of Conduct

By participating in this project you agree to abide by our Code of Conduct. Please be
respectful and constructive in all interactions. Report unacceptable behavior to
hprincivil@gmail.com.
