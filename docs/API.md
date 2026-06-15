# Public API (v1)

Sveltry exposes a small read-only HTTP API for querying projects and issues from
CI, scripts, and other tools. It is authenticated by an organization API token
and is served from the same origin as ingest (the Convex backend's HTTP-actions
origin, e.g. `https://ingest.your-domain.com`).

Broader resource coverage (events, releases, members) and pagination cursors are
on the [roadmap](./ROADMAP.md).

## Authentication

Create a token on the dashboard: **Settings -> API tokens -> Create token**
(owner or admin only). Choose an access level:

- **Read only** - the `GET` endpoints.
- **Read & write** - also the `POST` triage endpoints (resolve / ignore /
  unresolve). A `read` token that calls a write endpoint gets `403`.

The raw token is shown once; copy it then. Only a SHA-1 hash is stored, so a lost
token cannot be recovered, only revoked and re-created.

Send it as a bearer token:

```
Authorization: Bearer svtry_xxxxxxxx...
```

Every request is scoped to the token's organization. A missing, malformed, or
revoked token returns `401`.

## Endpoints

Base path: `/api/v1`. All responses are JSON.

### `GET /api/v1/projects`

The organization's projects.

```json
{
  "projects": [
    { "id": "...", "slug": "web-app", "name": "Web App", "platform": "javascript", "publicId": "279458726" }
  ]
}
```

### `GET /api/v1/projects/<slug>/issues`

A project's issues, newest first. Returns `404` if the slug is not a project in
the organization.

Query parameters:

- `status` - one of `unresolved`, `resolved`, `ignored`. Omit for all statuses.
- `limit` - number of issues to return (default 50, max 100).

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
  ]
}
```

### `GET /api/v1/issues/<id>`

A single issue by id (the `id` from the lists above), with its project. Returns
`404` if the issue is not in the organization.

### `GET /api/v1/issues/<id>/events`

Recent events for an issue, newest first. `?limit=` (default 50, max 100).

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
  ]
}
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
curl -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/projects/web-app/issues?status=unresolved&limit=20"
curl -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/issues/<id>"
```

## Errors

| Status | Meaning |
| --- | --- |
| `401` | Missing, malformed, or revoked token. |
| `403` | A read-only token called a write (triage) endpoint. |
| `404` | Unknown endpoint, project, or issue (or an issue outside your org). |
| `400` | A malformed project slug. |
| `200` | Success. |
