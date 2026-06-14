/**
 * @aihxp/sveltry-sdk
 *
 * Helpers for pointing official Sentry SDKs at a self-hosted Sveltry deployment.
 * Sveltry speaks the Sentry wire protocol, so you keep using the battle-tested
 * `@sentry/*` clients and just change where events are sent.
 */

export { buildSveltryDsn, dsnFromEnvelopeHeader, ingestUrlFromDsn, parseDsn } from './dsn.js';
export type { SveltryDsnParts, ParsedDsn } from './dsn.js';

export { recommendedSentryOptions } from './config.js';
export type { SveltryInitOptions } from './config.js';

export { createTunnelHandler } from './tunnel.js';
export type { TunnelOptions } from './tunnel.js';

export { uploadSourceMaps } from './upload.js';
export type { UploadSourceMapsOptions, UploadResult, ArtifactFile } from './upload.js';

/** Library version, kept in sync with package.json by the release process. */
export const VERSION = '0.1.0';
