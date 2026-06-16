import { GROUPING_CONFIG_VERSION } from '@sveltry/types';
import type {
  IssueGrouping,
  NormalizedEvent,
  SentryEventPayload,
  SentryStackFrame,
} from '@sveltry/types';
import { sha1Hex } from './hash.js';
import { exceptionValues, messageString } from './normalize.js';

const DEFAULT_TOKEN = '{{ default }}';

/**
 * Replace dynamic substrings (UUIDs, hex blobs, numbers, hex addresses) with
 * stable placeholders so that otherwise-identical errors group together instead
 * of exploding into thousands of near-duplicate issues.
 */
export function normalizeDynamicValues(input: string): string {
  return input
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<addr>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hex>')
    .replace(/\d+/g, '<n>')
    .trim();
}

/** Basename of a path-like string (handles both `/` and `\\`). */
function basename(p: string | undefined): string {
  if (!p) return '';
  const norm = p.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i === -1 ? norm : norm.slice(i + 1);
}

/** A single frame's contribution to the grouping signature (line numbers excluded). */
function frameSignature(frame: SentryStackFrame): string {
  const module = frame.module ?? '';
  const fn = frame.function ?? frame.raw_function ?? '';
  const file = basename(frame.filename ?? frame.abs_path);
  return `${module}|${fn}|${file}`;
}

/** Build the default grouping component list from an event payload. */
export function defaultGroupingComponents(payload: SentryEventPayload): string[] {
  const top = exceptionValues(payload)[0];
  const frames = top?.stacktrace?.frames;

  if (frames && frames.length > 0) {
    const inApp = frames.filter((f) => f.in_app);
    const chosen = inApp.length > 0 ? inApp : frames;
    const sigs = chosen.map(frameSignature).filter((s) => s.replace(/\|/g, '') !== '');
    const components = sigs.length > 0 ? sigs : frames.map(frameSignature);
    return [top?.type ?? 'Error', ...components];
  }

  if (top) {
    return [top.type ?? 'Error', normalizeDynamicValues(top.value ?? '')];
  }

  const msg = messageString(payload);
  if (msg) return [normalizeDynamicValues(msg)];

  // Last resort: group by transaction/culprit.
  return [payload.transaction ?? payload.culprit ?? 'unknown'];
}

/**
 * Compute the grouping fingerprint for an event. Honors an SDK-provided
 * `fingerprint` array (including the `{{ default }}` merge token) and falls
 * back to the default stack-trace/exception/message grouping.
 */
export function computeGrouping(
  payload: SentryEventPayload,
  normalized: NormalizedEvent,
): IssueGrouping {
  const defaults = defaultGroupingComponents(payload);

  let components: string[];
  const provided = payload.fingerprint;
  if (Array.isArray(provided) && provided.length > 0) {
    components = [];
    for (const part of provided) {
      if (part === DEFAULT_TOKEN) {
        components.push(...defaults);
      } else {
        components.push(normalizeDynamicValues(String(part)));
      }
    }
  } else {
    components = defaults;
  }

  const seed = [GROUPING_CONFIG_VERSION, ...components].join('\n');
  const fingerprint = sha1Hex(seed);

  return {
    fingerprint,
    groupingConfig: GROUPING_CONFIG_VERSION,
    title: normalized.message,
    culprit: normalized.culprit,
    errorType: normalized.errorType,
  };
}
