/**
 * Inbound data filters: drop incoming error events before they are stored, before
 * they group into issues, and before they count toward a quota, mirroring Sentry's
 * per-project inbound filters. The matcher is pure and string-only so it unit-tests
 * like ssrf.ts and the fingerprint module; the ingest action applies it per event
 * and records the drops under a separate `filtered` usage reason so nothing
 * silently vanishes.
 *
 * Patterns are case-insensitive globs: `*` matches any run of characters, `?`
 * matches exactly one, and the pattern is anchored to the whole field (the same
 * semantics Sentry documents). A substring match therefore needs explicit `*`
 * wraps, e.g. `*ResizeObserver*`. Only `*` and `?` are special; every other
 * character is matched literally, so a self-hoster cannot trigger catastrophic
 * regex backtracking from the rule editor.
 */
import type { SentryEventPayload } from '@sveltry/types';
import { exceptionValues } from './normalize.js';

/** Per-project inbound filter configuration. Every part is optional; an empty config is a no-op. */
export interface InboundFilters {
  /** Glob patterns matched against the event title (`Type: value`) and the exception type. */
  ignoreErrors?: string[];
  /** Glob patterns matched against the release. */
  ignoreReleases?: string[];
  /** Glob patterns matched against the environment. */
  ignoreEnvironments?: string[];
  /**
   * Glob patterns matched against any stack-frame file path (`filename`,
   * `abs_path`, or `module`). Handy for noise like `chrome-extension://*`.
   */
  ignorePaths?: string[];
  /** Drop events whose request `User-Agent` looks like a known web crawler. */
  filterBots?: boolean;
}

/** The already-extracted fields the matcher needs, decoupled from the raw payload shape. */
export interface InboundFilterInput {
  /** The derived issue title (`Type: value`), used for `ignoreErrors`. */
  message: string;
  /** The exception type, also tested against `ignoreErrors`. */
  errorType?: string;
  release?: string;
  environment?: string;
  /** The request user-agent, tested when `filterBots` is on. */
  userAgent?: string;
  /** Stack-frame file paths, tested against `ignorePaths`. */
  paths: string[];
}

/** Why an event was filtered. Surfaced for usage accounting and debugging. */
export type InboundFilterReason =
  | 'error_message'
  | 'release'
  | 'environment'
  | 'file_path'
  | 'web_crawler';

/**
 * Known web crawlers and automated agents, mirroring Sentry's web-crawler inbound
 * filter. Matched as a case-insensitive substring against the request user-agent.
 * Includes search-engine bots, social-preview fetchers, common HTTP clients, and
 * the newer AI crawlers, plus the generic `crawler`/`spider`/`bot` markers.
 */
const WEB_CRAWLERS =
  /(Googlebot|Mediapartners-Google|AdsBot-Google|FeedFetcher-Google|Google-Read-Aloud|APIs-Google|bingbot|BingPreview|msnbot|Baiduspider|YandexBot|DuckDuckBot|Slurp|Sogou|Exabot|facebookexternalhit|facebot|ia_archiver|AhrefsBot|SemrushBot|DotBot|MJ12bot|PetalBot|Applebot|Twitterbot|Discordbot|Slackbot|TelegramBot|WhatsApp|LinkedInBot|Pinterest|redditbot|Embedly|Quora\s*Link\s*Preview|outbrain|vkShare|W3C_Validator|python-requests|aiohttp|Go-http-client|Java\/|libwww-perl|curl\/|Wget\/|HeadlessChrome|PhantomJS|Lighthouse|GPTBot|ChatGPT-User|OAI-SearchBot|CCBot|ClaudeBot|anthropic-ai|Bytespider|PerplexityBot|crawler|spider|crawling)/i;

/** Whether a user-agent string belongs to a known crawler / automated agent. */
export function isWebCrawler(userAgent: string): boolean {
  return WEB_CRAWLERS.test(userAgent);
}

/** Compile one glob pattern into an anchored, case-insensitive RegExp. */
function globToRegExp(pattern: string): RegExp {
  // Escape every regex metacharacter, then turn the now-escaped `*`/`?` (the only
  // wildcards we honor) back into their regex equivalents. Anchored end to end.
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = escaped.replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
  return new RegExp(`^${body}$`, 'i');
}

/** A precompiled filter set, so the globs are built once per ingest batch, not per event. */
export interface CompiledInboundFilters {
  errors: RegExp[];
  releases: RegExp[];
  environments: RegExp[];
  paths: RegExp[];
  filterBots: boolean;
  /** False when nothing is configured, so the hot path can short-circuit. */
  active: boolean;
}

/** Compile a project's inbound filters once. Blank patterns are dropped. */
export function compileInboundFilters(
  filters: InboundFilters | undefined | null,
): CompiledInboundFilters {
  const compile = (patterns: string[] | undefined): RegExp[] =>
    (patterns ?? [])
      .map((p) => p.trim())
      .filter(Boolean)
      .map(globToRegExp);
  const errors = compile(filters?.ignoreErrors);
  const releases = compile(filters?.ignoreReleases);
  const environments = compile(filters?.ignoreEnvironments);
  const paths = compile(filters?.ignorePaths);
  const filterBots = !!filters?.filterBots;
  return {
    errors,
    releases,
    environments,
    paths,
    filterBots,
    active:
      errors.length > 0 ||
      releases.length > 0 ||
      environments.length > 0 ||
      paths.length > 0 ||
      filterBots,
  };
}

/** Test a single event against precompiled filters; returns the first matching reason or null. */
export function matchCompiledFilter(
  input: InboundFilterInput,
  compiled: CompiledInboundFilters,
): InboundFilterReason | null {
  if (!compiled.active) return null;

  for (const re of compiled.errors) {
    if (re.test(input.message) || (input.errorType != null && re.test(input.errorType))) {
      return 'error_message';
    }
  }
  if (input.release != null) {
    for (const re of compiled.releases) if (re.test(input.release)) return 'release';
  }
  if (input.environment != null) {
    for (const re of compiled.environments) if (re.test(input.environment)) return 'environment';
  }
  if (compiled.paths.length > 0) {
    for (const path of input.paths) {
      for (const re of compiled.paths) if (re.test(path)) return 'file_path';
    }
  }
  if (compiled.filterBots && input.userAgent && isWebCrawler(input.userAgent)) {
    return 'web_crawler';
  }
  return null;
}

/** Convenience for tests and one-off use: compile then match in one call. */
export function matchInboundFilter(
  input: InboundFilterInput,
  filters: InboundFilters | undefined | null,
): InboundFilterReason | null {
  return matchCompiledFilter(input, compileInboundFilters(filters));
}

/** Extract the request user-agent from a payload's request headers (case-insensitive). */
function requestUserAgent(payload: SentryEventPayload): string | undefined {
  const headers = payload.request?.headers;
  if (!headers || typeof headers !== 'object') return undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'user-agent' && typeof value === 'string') return value;
  }
  return undefined;
}

/** Every stack-frame file path in the event (deduped), for `ignorePaths`. */
function framePaths(payload: SentryEventPayload): string[] {
  const seen = new Set<string>();
  for (const ex of exceptionValues(payload)) {
    for (const frame of ex.stacktrace?.frames ?? []) {
      const path = frame.filename ?? frame.abs_path ?? frame.module;
      if (typeof path === 'string' && path) seen.add(path);
    }
  }
  return [...seen];
}

/**
 * Build the matcher input from a raw payload plus the already-normalized event
 * (so the title/type/release/environment are not re-derived). The ingest action
 * passes the result to `matchCompiledFilter`.
 */
export function inboundFilterInput(
  payload: SentryEventPayload,
  normalized: {
    message: string;
    errorType?: string;
    release?: string;
    environment?: string;
  },
): InboundFilterInput {
  return {
    message: normalized.message,
    errorType: normalized.errorType,
    release: normalized.release,
    environment: normalized.environment,
    userAgent: requestUserAgent(payload),
    paths: framePaths(payload),
  };
}
