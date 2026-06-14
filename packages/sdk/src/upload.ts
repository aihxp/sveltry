import { parseDsn } from './dsn.js';

/** A single build artifact to upload: a minified bundle or a `.map` file. */
export interface ArtifactFile {
  /**
   * The artifact path as it appears in stack frames (or its `.map`), e.g.
   * `~/app.min.js` or `app.min.js.map`. Names ending in `.map` are stored as
   * source maps and used to resolve minified frames.
   */
  name: string;
  content: string | Uint8Array;
  contentType?: string;
}

export interface UploadSourceMapsOptions {
  /** The project's Sveltry DSN (the same one your Sentry SDK uses). */
  dsn: string;
  /** The release these artifacts belong to (match your SDK's `release`). */
  release: string;
  files: ArtifactFile[];
  /** Override the global `fetch` (e.g. in older runtimes). */
  fetchImpl?: typeof fetch;
}

export interface UploadResult {
  name: string;
  ok: boolean;
  status: number;
  kind?: 'minified' | 'sourcemap';
  error?: string;
}

/**
 * Upload a release's build artifacts (minified bundles and their source maps) to
 * a self-hosted Sveltry deployment so minified production stack frames resolve to
 * original source. Authenticated by the DSN public key. Intended for CI:
 *
 * ```ts
 * await uploadSourceMaps({
 *   dsn: process.env.SVELTRY_DSN!,
 *   release: process.env.GIT_SHA!,
 *   files: [{ name: '~/app.min.js.map', content: await readFile('dist/app.min.js.map') }],
 * });
 * ```
 */
export async function uploadSourceMaps(opts: UploadSourceMapsOptions): Promise<UploadResult[]> {
  const dsn = parseDsn(opts.dsn);
  if (!dsn) throw new Error('uploadSourceMaps: invalid Sveltry DSN');
  const doFetch = opts.fetchImpl ?? fetch;

  const results: UploadResult[] = [];
  for (const file of opts.files) {
    const url =
      `${dsn.origin}/artifacts/upload` +
      `?sentry_key=${encodeURIComponent(dsn.publicKey)}` +
      `&o=${encodeURIComponent(dsn.projectId)}` +
      `&release=${encodeURIComponent(opts.release)}` +
      `&name=${encodeURIComponent(file.name)}`;
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': file.contentType ?? 'application/octet-stream' },
        // string and Uint8Array are both valid fetch bodies; the cast sidesteps
        // the generic Uint8Array<ArrayBufferLike> vs BodyInit narrowing in TS 5.9.
        body: file.content as BodyInit,
      });
      let kind: UploadResult['kind'];
      try {
        kind = ((await res.json()) as { kind?: UploadResult['kind'] }).kind;
      } catch {
        // body may be empty on error; ignore
      }
      results.push({ name: file.name, ok: res.ok, status: res.status, kind });
    } catch (err) {
      results.push({
        name: file.name,
        ok: false,
        status: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
