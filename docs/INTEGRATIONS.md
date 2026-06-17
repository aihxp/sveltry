# Integrations

Sveltry is wire-compatible with the official Sentry SDKs, so you integrate with
the same client you would use with Sentry (`@sentry/*`, `sentry-sdk`,
`sentry-go`, ...). **Only the DSN changes**: point it at your Sveltry ingest
origin.

Your DSN is shown when you create a project (and on the project page). It looks
like:

```
http://PUBLIC_KEY@your-ingest-host:PORT/PROJECT_ID
```

(`https` once the ingest origin is behind TLS). In every snippet below, replace
`<YOUR_DSN>` with that value.

## Browser JavaScript

```sh
npm install @sentry/browser
```

```js
import * as Sentry from '@sentry/browser';

Sentry.init({ dsn: '<YOUR_DSN>' });

// Test it:
Sentry.captureException(new Error('Sveltry test event'));
```

## Node.js

```sh
npm install @sentry/node
```

```js
import * as Sentry from '@sentry/node';

Sentry.init({ dsn: '<YOUR_DSN>' });

Sentry.captureException(new Error('Sveltry test event'));
```

## Python

```sh
pip install sentry-sdk
```

```python
import sentry_sdk

sentry_sdk.init(dsn="<YOUR_DSN>")

sentry_sdk.capture_exception(Exception("Sveltry test event"))
```

## Go

```sh
go get github.com/getsentry/sentry-go
```

```go
import "github.com/getsentry/sentry-go"

sentry.Init(sentry.ClientOptions{
    Dsn: "<YOUR_DSN>",
})

sentry.CaptureException(fmt.Errorf("Sveltry test event"))
sentry.Flush(2 * time.Second)
```

## Ruby

```sh
gem install sentry-ruby
```

```ruby
require 'sentry-ruby'

Sentry.init do |config|
  config.dsn = '<YOUR_DSN>'
end

Sentry.capture_exception(StandardError.new('Sveltry test event'))
```

## Java

```groovy
// build.gradle
implementation 'io.sentry:sentry:7.+'
```

```java
import io.sentry.Sentry;

Sentry.init(options -> {
  options.setDsn("<YOUR_DSN>");
});

Sentry.captureException(new RuntimeException("Sveltry test event"));
```

## PHP

```sh
composer require sentry/sentry
```

```php
\Sentry\init(['dsn' => '<YOUR_DSN>']);

\Sentry\captureException(new \Exception('Sveltry test event'));
```

## Rust

```sh
cargo add sentry
```

```rust
let _guard = sentry::init("<YOUR_DSN>");

sentry::capture_error(&std::io::Error::new(std::io::ErrorKind::Other, "Sveltry test event"));
```

## Frameworks

Use the official **framework** SDK exactly as you would with Sentry, and point its
DSN at Sveltry. For example `@sentry/sveltekit`, `@sentry/nextjs`, `@sentry/react`,
`@sentry/vue`, Django (`sentry_sdk` + `DjangoIntegration`), Rails
(`sentry-rails`), Laravel (`sentry/sentry-laravel`). Nothing else changes, the
DSN routes events to Sveltry.

## Source maps (minified JavaScript)

Sveltry symbolicates minified stack frames server-side. Upload your build
artifacts (minified files + source maps) per release with `sentry-cli`, or use
the helper in [`@aihxp/sveltry-sdk`](../packages/sdk). See
[Sentry compatibility](SENTRY_COMPATIBILITY.md) for the artifact-upload endpoint.

## Tunneling past ad-blockers (browser)

Ad-blockers sometimes block requests to error-tracking hosts. Route browser
events through your own origin with the Sentry `tunnel` option and the
ad-blocker-proof handler in [`@aihxp/sveltry-sdk`](../packages/sdk):

```js
Sentry.init({ dsn: '<YOUR_DSN>', tunnel: '/monitoring' });
```

and mount `createTunnelHandler({ allowedHosts: ['your-ingest-host'] })` at
`/monitoring`.

## What's supported

For the precise list of envelope item types, endpoints, and SDK features Sveltry
implements (events, transactions, sessions, replays, profiles, check-ins,
attachments, and the known limitations), see
[Sentry compatibility](SENTRY_COMPATIBILITY.md).
