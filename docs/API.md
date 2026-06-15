# Public API (v1)

Sveltry exposes an HTTP API for querying and triaging projects, issues, events,
releases, and members from CI, scripts, and other tools. It is authenticated by
an organization API token and is served from the same origin as ingest (the
Convex backend's HTTP-actions origin, e.g. `https://ingest.your-domain.com`).

## Authentication

Create a token on the dashboard: **Settings -> API tokens -> Create token**
(owner or admin only). Choose an access level:

- **Read only** - the `GET` endpoints.
- **Read & write** - also the `POST` endpoints: assign (`/assign`) and triage
  (resolve / ignore / unresolve). A `read` token that calls a write endpoint
  gets `403`.

The raw token is shown once; copy it then. Only a SHA-1 hash is stored, so a lost
token cannot be recovered, only revoked and re-created.

Send it as a bearer token:

```
Authorization: Bearer svtry_xxxxxxxx...
```

Every request is scoped to the token's organization. A missing, malformed, or
revoked token returns `401`.

## Pagination

The paginated endpoints (`/releases`, `/members`, a project's `/issues` and
`/deploys`, and an issue's `/events`) return at most `limit` items per page and an
opaque `nextCursor`:

- `limit` - page size (default 50, max 100). Out-of-range or non-numeric values
  are clamped to `[1, 100]` (or fall back to the default), not rejected.
- `cursor` - pass back the previous response's `nextCursor` to fetch the next
  page. Omit it for the first page.

Each list response includes a `nextCursor` field: an opaque string when more
pages remain, or `null` when the list is exhausted. A malformed `cursor` returns
`400`. Consumers that ignore `nextCursor` still receive up to `limit` items.

`GET /api/v1/projects` is not paginated: it returns all of the organization's
projects in one response (its `nextCursor` is always `null`).

```bash
# First page, then follow the cursor:
curl -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/members?limit=50"
curl -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/members?limit=50&cursor=<nextCursor>"
```

## Endpoints

Base path: `/api/v1`. All responses are JSON.

### `GET /api/v1/projects`

The organization's projects (all of them, in one response; not paginated).

```json
{
  "projects": [
    { "id": "...", "slug": "web-app", "name": "Web App", "platform": "javascript", "publicId": "279458726" }
  ],
  "nextCursor": null
}
```

### `GET /api/v1/releases`

The organization's releases, newest first. Paginated. A release row exists once
an error event carried a `release` (this lists the release registry, not
release-health sessions).

Query parameters:

- `project` - a project slug, to list only that project's releases. Returns
  `404` if the slug is not a project in the organization.
- `cursor`, `limit` - pagination.

```json
{
  "releases": [
    {
      "id": "...",
      "version": "web@1.2.3",
      "ref": null,
      "url": null,
      "createdAt": 1781493600000,
      "firstEventAt": 1781490000000,
      "lastEventAt": 1781493600000
    }
  ],
  "nextCursor": null
}
```

### `GET /api/v1/members`

The organization's members. Paginated.

```json
{
  "members": [
    { "id": "...", "userId": "...", "email": "dev@example.com", "name": "Dev", "role": "owner" }
  ],
  "nextCursor": null
}
```

`userId` is the value used as `assigneeId` when assigning issues. `role` is one
of `owner`, `admin`, `member`, `billing`.

### `GET /api/v1/projects/<slug>/issues`

A project's issues, newest first. Paginated. Returns `404` if the slug is not a
project in the organization.

Query parameters:

- `status` - one of `unresolved`, `resolved`, `ignored`. Omit for all statuses.
- `cursor`, `limit` - pagination.

```json
{
  "project": { "slug": "web-app", "name": "Web App" },
  "issues": [
    {
      "id": "...",
      "title": "TypeError: undefined is not a function",
      "culprit": "render (app/main.js)",
      "level": "error",
      "status": "unresolved",
      "substatus": "new",
      "count": 12,
      "userCount": 4,
      "firstSeen": 1781490000000,
      "lastSeen": 1781493600000,
      "errorType": "TypeError",
      "assigneeId": null
    }
  ],
  "nextCursor": null
}
```

### `GET /api/v1/issues/<id>`

A single issue by id (the `id` from the lists above), with its project. Returns
`404` if the issue is not in the organization.

### `GET /api/v1/events/<eventId>`

A single event by its Sentry event id, with the full stored payload (stack
frames, breadcrumbs, request, contexts). Returns `404` if the event is not in the
organization.

```json
{
  "id": "...",
  "eventId": "c1c1...",
  "issueId": "...",
  "timestamp": 1781493600000,
  "receivedAt": 1781493600050,
  "level": "error",
  "platform": "javascript",
  "environment": "production",
  "release": "web@1.2.3",
  "message": "TypeError: undefined is not a function",
  "culprit": "render (app/main.js)",
  "tags": { "release": "web@1.2.3" },
  "payload": { "exception": { "values": [] }, "breadcrumbs": [], "request": {}, "contexts": {} }
}
```

Event ids are unique per project, not globally; this looks up the first match in
your organization. Use the project-scoped form below to disambiguate.

### `GET /api/v1/projects/<slug>/events/<eventId>`

The strict, project-scoped form of the above: a single event by its Sentry event
id within a specific project (event ids are unique per project, so this is
collision-proof). Same response shape as `GET /events/<eventId>`. Returns `404
project not found` for an unknown slug, or `404 event not found` if the event is
not in that project.

### `GET /api/v1/projects/<slug>/deploys`

A project's deploys, newest first. Paginated (`?cursor=`, `?limit=`). Returns
`404` if the slug is not a project in the organization.

```json
{
  "deploys": [
    {
      "id": "...",
      "release": "web@1.2.3",
      "environment": "production",
      "name": "ci-1024",
      "url": "https://ci.example.com/runs/1024",
      "deployedAt": 1781493600000
    }
  ],
  "nextCursor": null
}
```

### `GET /api/v1/issues/<id>/events`

Recent events for an issue, newest first. Paginated (`?cursor=`, `?limit=`). The
compact projection (no full payload); use `GET /events/<eventId>` for detail.

```json
{
  "events": [
    {
      "eventId": "c1c1...",
      "timestamp": 1781493600000,
      "level": "error",
      "platform": "javascript",
      "environment": "production",
      "release": null,
      "message": "TypeError: undefined is not a function",
      "culprit": "render (app/main.js)",
      "tags": { "release": "web@1.2.3" }
    }
  ],
  "nextCursor": null
}
```

### `POST /api/v1/issues/<id>/assign`

Assign or unassign an issue (requires a **write** token). Body:

```json
{ "assigneeId": "<userId>" }
```

`assigneeId` is a member's `userId` (from `GET /members`), or `null` to unassign.
The assignee must be a member of the organization. Returns
`{ "ok": true, "assigneeId": "<userId>" | null }`. `403` for a read-only token,
`400` if `assigneeId` is not a string or null or is not a member, `404` if the
issue is not in the organization.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"assigneeId":"<userId>"}' "$BASE/api/v1/issues/<id>/assign"
```

### `POST /api/v1/issues/<id>/resolve` · `/ignore` · `/unresolve`

Triage an issue (requires a **write** token). Sets the issue's status; returns
`{ "ok": true, "status": "resolved" }`. `403` for a read-only token, `404` if the
issue is not in the organization.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/issues/<id>/resolve"
```

## Examples

```bash
TOKEN=svtry_...
BASE=https://ingest.your-domain.com

curl -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/projects"
curl -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/releases?project=web-app"
curl -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/members"
curl -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/projects/web-app/issues?status=unresolved&limit=20"
curl -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/issues/<id>"
curl -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/events/<eventId>"
```

## Errors

| Status | Meaning |
| --- | --- |
| `401` | Missing, malformed, or revoked token. |
| `403` | A read-only token called a write (assign / triage) endpoint. |
| `404` | Unknown endpoint, project, issue, or event (or one outside your org). |
| `400` | A malformed slug or event id, an invalid cursor, a malformed body, or an assignee that is not a member. |
| `200` | Success. |

A malformed *issue* id returns `404` (it is indistinguishable from an issue
outside your organization), whereas a malformed *slug* or *event id* returns
`400`.
