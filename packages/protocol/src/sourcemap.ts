/**
 * Pure source-map helpers shared by the ingest pipeline. The heavy lifting (the
 * `SourceMapConsumer` position lookup) is done by the caller with `source-map-js`;
 * everything here is dependency-free and unit-tested: matching a stack frame to a
 * map artifact, reading the `sourceMappingURL` annotation, cleaning original
 * source names, and rewriting a frame from a resolved position.
 */

import type { SentryStackFrame } from '@sveltry/types';

/** Strip a URL query string and fragment, leaving the path portion. */
export function stripUrlSuffix(ref: string): string {
  let end = ref.length;
  const q = ref.indexOf('?');
  const h = ref.indexOf('#');
  if (q >= 0) end = Math.min(end, q);
  if (h >= 0) end = Math.min(end, h);
  return ref.slice(0, end);
}

/** The final path segment of a file ref (handles both `/` and `\\`). */
export function basename(ref: string): string {
  const clean = stripUrlSuffix(ref);
  const slash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  return slash >= 0 ? clean.slice(slash + 1) : clean;
}

/**
 * Normalize a frame/artifact reference for comparison: drop query/fragment and
 * the host-relative prefixes SDKs and bundlers emit (`~/`, `app:///`, an
 * `http(s)://host/` origin), so `https://cdn/app.min.js` and `~/app.min.js` match.
 */
export function normalizeRef(ref: string): string {
  let r = stripUrlSuffix(ref).trim();
  r = r.replace(/^https?:\/\/[^/]+\//, '');
  r = r.replace(/^app:\/\/\//, '');
  r = r.replace(/^~\//, '');
  r = r.replace(/^\.?\//, '');
  return r;
}

/** Parse the last `//# sourceMappingURL=...` (or legacy `//@`) annotation, if any. */
export function parseSourceMappingURL(js: string): string | null {
  const re = /\/[/*][#@]\s*sourceMappingURL=([^\s'"*]+)/g;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(js)) !== null) last = m[1] ?? null;
  return last;
}

/**
 * Parse the last `//# debugId=<id>` (or legacy `//@`) annotation a bundler stamps
 * into a minified file, if any. Debug IDs let a frame match its source map by a
 * stable identity instead of by path/release, so resolution survives renames.
 */
export function parseDebugId(js: string): string | null {
  const re = /\/[/*][#@]\s*debugId\s*=\s*([0-9a-fA-F-]+)/g;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(js)) !== null) last = m[1] ?? null;
  return last;
}

/** Read a source map's embedded debug id (`debugId` or `debug_id`), if present. */
export function debugIdFromSourceMap(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  const id = o.debugId ?? o.debug_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** A `debug_meta.images` entry. JS SDKs emit `type: 'sourcemap'` images. */
export interface DebugMetaImage {
  type?: string;
  code_file?: string;
  debug_id?: string;
  [key: string]: unknown;
}

/** Coerce an event's `debug_meta.images` into typed entries that carry a debug id. */
export function debugMetaImages(images: readonly unknown[] | undefined): DebugMetaImage[] {
  if (!Array.isArray(images)) return [];
  return images.filter(
    (i): i is DebugMetaImage =>
      !!i && typeof i === 'object' && typeof (i as DebugMetaImage).debug_id === 'string',
  );
}

/**
 * The debug id that applies to a frame, by matching the frame's file reference to
 * an image's `code_file`. Tries an exact normalized match, then a basename match,
 * then falls back to the sole image when there is exactly one and its `code_file`
 * is absent (a common single-bundle case).
 */
export function debugIdForRef(ref: string, images: readonly DebugMetaImage[]): string | null {
  if (!ref || images.length === 0) return null;
  const wanted = normalizeRef(ref);
  const wantedBase = basename(wanted);
  for (const i of images) {
    if (i.code_file && normalizeRef(i.code_file) === wanted) return i.debug_id ?? null;
  }
  for (const i of images) {
    if (i.code_file && basename(normalizeRef(i.code_file)) === wantedBase)
      return i.debug_id ?? null;
  }
  if (images.length === 1 && !images[0]!.code_file) return images[0]!.debug_id ?? null;
  return null;
}

/** The file a frame points at, if any (prefers `abs_path`, falls back to `filename`). */
export function frameRef(frame: SentryStackFrame): string | null {
  return frame.abs_path ?? frame.filename ?? null;
}

/**
 * Choose the sourcemap artifact (by name) that resolves a frame, or null.
 * Tries, in order: `<ref>.map` exact, basename `<file>.map`, then a `.map`
 * whose basename (minus `.map`) equals the frame's basename.
 */
export function matchSourcemap(ref: string, sourcemapNames: readonly string[]): string | null {
  const wanted = normalizeRef(ref);
  const wantedBase = basename(wanted);
  const norm = sourcemapNames.map((n) => ({ raw: n, n: normalizeRef(n) }));

  for (const { raw, n } of norm) if (n === `${wanted}.map`) return raw;
  for (const { raw, n } of norm) if (basename(n) === `${wantedBase}.map`) return raw;
  for (const { raw, n } of norm) {
    if (n.endsWith('.map') && basename(n).slice(0, -4) === wantedBase) return raw;
  }
  return null;
}

/** A resolved original position from a source map consumer. */
export interface OriginalPosition {
  source: string | null;
  line: number | null;
  column: number | null;
  name: string | null;
}

/** Tidy a source-map `source` into a readable path (drop `webpack://`, `./`). */
export function cleanSourceName(source: string): string {
  return source
    .replace(/^webpack:\/\/\/?/, '')
    .replace(/^[^/]*:\/\//, '')
    .replace(/^\.\//, '');
}

/** Whether a resolved original source should count as in-app (not a dependency). */
export function isInAppSource(source: string): boolean {
  return !/(^|\/)(node_modules|webpack|webpack-internal)(\/|$)|\/~\//.test(source);
}

const CONTEXT_LINES = 5;

/**
 * Rewrite a frame from a resolved original position. When `sourceContent` is
 * available, populates `context_line` / `pre_context` / `post_context` so the UI
 * renders the original source. Returns the original frame unchanged if the
 * position did not resolve.
 */
export function applyOriginalPosition(
  frame: SentryStackFrame,
  pos: OriginalPosition,
  sourceContent: string | null,
): SentryStackFrame {
  if (pos.source == null || pos.line == null) return frame;
  const cleaned = cleanSourceName(pos.source);
  const out: SentryStackFrame = {
    ...frame,
    abs_path: pos.source,
    filename: cleaned,
    lineno: pos.line,
    colno: pos.column ?? frame.colno,
    in_app: isInAppSource(pos.source),
    sveltry_resolved: true,
  };
  if (pos.name) out.function = pos.name;

  if (sourceContent != null) {
    const lines = sourceContent.split('\n');
    const idx = pos.line - 1;
    if (idx >= 0 && idx < lines.length) {
      out.context_line = lines[idx];
      out.pre_context = lines.slice(Math.max(0, idx - CONTEXT_LINES), idx);
      out.post_context = lines.slice(idx + 1, idx + 1 + CONTEXT_LINES);
    }
  }
  return out;
}
