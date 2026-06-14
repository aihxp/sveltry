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
