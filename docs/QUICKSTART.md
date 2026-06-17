# Quickstart: send your first error

This takes you from a running Sveltry to your first tracked error in about five
minutes. It assumes Sveltry is already up; if not, start with
[Self-hosting](SELF_HOSTING.md) (or the repo `README` Quick start for a local
run).

Sveltry speaks the Sentry wire protocol, so you use the **official Sentry SDK for
your language, unmodified**. Only the DSN changes.

## 1. Create an account and organization

Open the dashboard, sign up, and create an organization when prompted. Projects
and issues live inside an organization.

## 2. Create a project

From the Overview's **Get started** checklist (or **Projects -> New project**),
create a project and pick your platform. You get a **DSN** and an install + init
snippet tailored to that SDK.

A DSN looks like:

```
http://PUBLIC_KEY@your-ingest-host:PORT/PROJECT_ID
```

Use `http` for a local backend and `https` once it is behind TLS.

## 3. Install and initialize the SDK

Copy the three steps shown on the project-created screen, or see
[Integrations](INTEGRATIONS.md) for every platform. For example, Node.js:

```sh
npm install @sentry/node
```

```js
import * as Sentry from '@sentry/node';

Sentry.init({ dsn: 'http://PUBLIC_KEY@your-ingest-host:PORT/PROJECT_ID' });
```

## 4. Send a test event

Trigger an error so the SDK captures it:

```js
Sentry.captureException(new Error('Sveltry test event'));
```

(or just let your app throw an uncaught error).

## 5. Watch it arrive

The project-created screen shows **"Listening for your first event..."** and
flips to **"First event received"** the moment it lands, with a link straight to
the issue. The same issue streams into the live **Issues** view.

That is it, you are tracking errors.

## Next steps

- [Integrations](INTEGRATIONS.md) - every supported SDK, with copy-paste install +
  init and framework notes.
- [Sentry compatibility](SENTRY_COMPATIBILITY.md) - exactly which envelope item
  types, endpoints, and SDK features are supported.
- [Self-hosting](SELF_HOSTING.md) - production TLS, domains, storage, and backups.
- In the dashboard, configure **alert rules** (webhook/Slack/Discord/email),
  **PII scrubbing**, and **retention** per project under **Projects -> settings**.
