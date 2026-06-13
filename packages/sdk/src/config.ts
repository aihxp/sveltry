import { buildSveltryDsn, type SveltryDsnParts } from './dsn.js';

/** Options for {@link recommendedSentryOptions}. */
export interface SveltryInitOptions extends Partial<SveltryDsnParts> {
  /** A pre-built DSN. Provide this instead of the `ingestHost`/`publicKey`/`projectId` parts. */
  dsn?: string;
  /** Release identifier (e.g. a git SHA or `app@1.2.3`). */
  release?: string;
  /** Deployment environment (`production`, `staging`, ...). */
  environment?: string;
  /** Trace sample rate (0..1). Defaults to 0 (errors only). */
  tracesSampleRate?: number;
  /** Tunnel route to proxy envelopes through your own origin (ad-blocker proof). */
  tunnel?: string;
  /** Send default PII (IP, request data). Defaults to false. */
  sendDefaultPii?: boolean;
}

/**
 * Produce a Sentry init options object pointed at a Sveltry deployment. Pass the
 * result straight to `Sentry.init(...)` from `@sentry/sveltekit` (or any other
 * official Sentry SDK):
 *
 * ```ts
 * import * as Sentry from '@sentry/sveltekit';
 * import { recommendedSentryOptions } from '@aihxp/sveltry-sdk';
 *
 * Sentry.init(recommendedSentryOptions({
 *   ingestHost: 'https://ingest.sveltry.example.com',
 *   publicKey: 'YOUR_PUBLIC_KEY',
 *   projectId: 1,
 *   release: import.meta.env.VITE_RELEASE,
 *   environment: import.meta.env.MODE,
 * }));
 * ```
 */
export function recommendedSentryOptions(options: SveltryInitOptions): Record<string, unknown> {
  const dsn =
    options.dsn ??
    (options.ingestHost && options.publicKey && options.projectId != null
      ? buildSveltryDsn({
          ingestHost: options.ingestHost,
          publicKey: options.publicKey,
          projectId: options.projectId,
        })
      : undefined);

  if (!dsn) {
    throw new Error(
      'recommendedSentryOptions: provide either `dsn` or all of `ingestHost`, `publicKey`, and `projectId`.',
    );
  }

  return {
    dsn,
    release: options.release,
    environment: options.environment,
    tracesSampleRate: options.tracesSampleRate ?? 0,
    sendDefaultPii: options.sendDefaultPii ?? false,
    ...(options.tunnel ? { tunnel: options.tunnel } : {}),
  };
}
