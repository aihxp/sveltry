import { v } from 'convex/values';
import { originalPositionFor, sourceContentFor, TraceMap } from '@jridgewell/trace-mapping';
import {
  applyOriginalPosition,
  corsHeaders,
  extractAuth,
  frameRef,
  ingestError,
  matchSourcemap,
  parseSourceMappingURL,
  type OriginalPosition,
} from '@sveltry/protocol';
import type { SentryEventPayload, SentryException, SentryStackFrame } from '@sveltry/types';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from './_generated/server';
import { requireOrg } from './lib/auth';

// ---------------------------------------------------------------------------
// Upload: POST /artifacts/upload?sentry_key=<key>&o=<publicId>&release=<v>&name=<n>
// Authenticated by a DSN key, one file (raw body) per request. Used by CI / the
// `@aihxp/sveltry-sdk` uploader to publish a release's minified bundles + maps.
// ---------------------------------------------------------------------------

export const uploadArtifact = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const cors = corsHeaders(request.headers.get('origin') ?? '*');
  const params = url.searchParams;

  const auth = extractAuth(request.headers.get('x-sentry-auth'), params);
  const publicKey = auth.sentry_key;
  const publicId = params.get('o') ?? '';
  const release = params.get('release') ?? '';
  const name = params.get('name') ?? '';

  if (!publicKey) return ingestError(401, 'missing sentry_key', [], cors);
  if (!publicId) return ingestError(400, 'missing project id (o=<publicId>)', [], cors);
  if (!release) return ingestError(400, 'missing release', [], cors);
  if (!name) return ingestError(400, 'missing artifact name', [], cors);

  const resolved = await ctx.runQuery(internal.projects.resolveIngestKey, { publicId, publicKey });
  if (!resolved) return ingestError(401, 'invalid dsn', ['unknown or revoked key'], cors);

  const buf = await request.arrayBuffer();
  const kind = name.endsWith('.map') ? ('sourcemap' as const) : ('minified' as const);
  const blob = new Blob([buf], {
    type: request.headers.get('content-type') ?? 'application/octet-stream',
  });
  const storageId = await ctx.storage.store(blob);

  let sourceMappingURL: string | undefined;
  if (kind === 'minified') {
    sourceMappingURL = parseSourceMappingURL(new TextDecoder().decode(buf)) ?? undefined;
  }

  await ctx.runMutation(internal.sourcemaps.recordArtifact, {
    projectId: resolved.projectId,
    organizationId: resolved.organizationId,
    release,
    name,
    kind,
    storageId,
    size: buf.byteLength,
    sourceMappingURL,
  });

  return new Response(JSON.stringify({ ok: true, name, kind, release }), {
    status: 201,
    headers: { 'content-type': 'application/json', ...cors },
  });
});

/** Upsert an artifact row, replacing the stored bytes if the name already exists. */
export const recordArtifact = internalMutation({
  args: {
    projectId: v.id('projects'),
    organizationId: v.string(),
    release: v.string(),
    name: v.string(),
    kind: v.union(v.literal('minified'), v.literal('sourcemap')),
    storageId: v.id('_storage'),
    size: v.number(),
    sourceMappingURL: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('releaseArtifacts')
      .withIndex('by_project_release_name', (q) =>
        q.eq('projectId', args.projectId).eq('release', args.release).eq('name', args.name),
      )
      .first();
    if (existing) {
      await ctx.storage.delete(existing.storageId);
      await ctx.db.patch(existing._id, {
        kind: args.kind,
        storageId: args.storageId,
        size: args.size,
        sourceMappingURL: args.sourceMappingURL,
        createdAt: Date.now(),
      });
      return;
    }
    await ctx.db.insert('releaseArtifacts', { ...args, createdAt: Date.now() });
  },
});

// ---------------------------------------------------------------------------
// Resolution: scheduled after ingest. Loads the release's source maps and
// rewrites minified frames to original source (with context lines).
// ---------------------------------------------------------------------------

export const getEventForResolve = internalQuery({
  args: { eventDocId: v.id('events') },
  handler: async (ctx, { eventDocId }) => {
    const event = await ctx.db.get(eventDocId);
    if (!event) return null;
    return {
      payload: event.payload as SentryEventPayload,
      release: event.release,
      projectId: event.projectId,
      issueId: event.issueId,
    };
  },
});

export const sourcemapsForRelease = internalQuery({
  args: { projectId: v.id('projects'), release: v.string() },
  handler: async (ctx, { projectId, release }) => {
    const artifacts = await ctx.db
      .query('releaseArtifacts')
      .withIndex('by_project_release', (q) => q.eq('projectId', projectId).eq('release', release))
      .collect();
    return artifacts
      .filter((a) => a.kind === 'sourcemap')
      .map((a) => ({ name: a.name, storageId: a.storageId }));
  },
});

function exceptionValues(payload: SentryEventPayload): SentryException[] {
  const ex = payload.exception;
  if (!ex) return [];
  return Array.isArray(ex) ? ex : (ex.values ?? []);
}

/** A readable culprit from the deepest resolved in-app frame, e.g. `fn (src/x.ts:42)`. */
function culpritFromFrames(frames: SentryStackFrame[]): string | null {
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i]!;
    if (f.sveltry_resolved && f.in_app) {
      const where = f.filename ?? f.abs_path ?? '?';
      return `${f.function ?? '?'} (${where}${f.lineno != null ? ':' + f.lineno : ''})`;
    }
  }
  return null;
}

export const resolveEvent = internalAction({
  args: { eventDocId: v.id('events') },
  handler: async (ctx, { eventDocId }) => {
    const event = await ctx.runQuery(internal.sourcemaps.getEventForResolve, { eventDocId });
    if (!event || !event.release) return;

    const values = exceptionValues(event.payload);
    const hasMinified = values.some((ex) =>
      (ex.stacktrace?.frames ?? []).some(
        (f) => typeof f.lineno === 'number' && typeof f.colno === 'number',
      ),
    );
    if (!hasMinified) return;

    const maps = await ctx.runQuery(internal.sourcemaps.sourcemapsForRelease, {
      projectId: event.projectId,
      release: event.release,
    });
    if (maps.length === 0) return;
    const mapNames = maps.map((m) => m.name);

    // Lazily load + parse each map at most once per run. `@jridgewell/trace-mapping`
    // is pure JS (no `eval`/`new Function`), so it runs in the Convex isolate.
    const tracers = new Map<string, TraceMap | null>();
    const tracerFor = async (name: string): Promise<TraceMap | null> => {
      if (tracers.has(name)) return tracers.get(name) ?? null;
      const entry = maps.find((m) => m.name === name);
      let tracer: TraceMap | null = null;
      try {
        const blob = entry ? await ctx.storage.get(entry.storageId) : null;
        if (blob) tracer = new TraceMap(JSON.parse(await blob.text()));
      } catch {
        tracer = null;
      }
      tracers.set(name, tracer);
      return tracer;
    };

    let anyResolved = false;
    for (const ex of values) {
      const frames = ex.stacktrace?.frames;
      if (!frames) continue;
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i]!;
        if (typeof frame.lineno !== 'number' || typeof frame.colno !== 'number') continue;
        const ref = frameRef(frame);
        if (!ref) continue;
        const mapName = matchSourcemap(ref, mapNames);
        if (!mapName) continue;
        const tracer = await tracerFor(mapName);
        if (!tracer) continue;
        const pos = originalPositionFor(tracer, {
          line: frame.lineno,
          column: frame.colno,
        }) as OriginalPosition;
        if (pos.source == null) continue;
        const content = sourceContentFor(tracer, pos.source) ?? null;
        frames[i] = applyOriginalPosition(frame, pos, content);
        anyResolved = true;
      }
    }

    if (!anyResolved) return;

    // Best-effort improved culprit from the resolved frames of the first exception.
    const culprit = values[0]?.stacktrace?.frames
      ? culpritFromFrames(values[0].stacktrace.frames)
      : null;

    await ctx.runMutation(internal.sourcemaps.applyResolution, {
      eventDocId,
      issueId: event.issueId,
      payload: event.payload,
      culprit: culprit ?? undefined,
    });
  },
});

export const applyResolution = internalMutation({
  args: {
    eventDocId: v.id('events'),
    issueId: v.id('issues'),
    payload: v.any(),
    culprit: v.optional(v.string()),
  },
  handler: async (ctx, { eventDocId, issueId, payload, culprit }) => {
    const event = await ctx.db.get(eventDocId);
    if (event) await ctx.db.patch(eventDocId, { payload, resolved: true });
    if (culprit) {
      const issue = await ctx.db.get(issueId);
      if (issue) await ctx.db.patch(issueId, { culprit });
    }
  },
});

// ---------------------------------------------------------------------------
// Dashboard query
// ---------------------------------------------------------------------------

/** List a project's uploaded artifacts, newest release first, for the project page. */
export const listProjectArtifacts = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const { activeOrganizationId } = await requireOrg(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.organizationId !== activeOrganizationId) return [];
    const artifacts = await ctx.db
      .query('releaseArtifacts')
      .withIndex('by_project_release', (q) => q.eq('projectId', projectId))
      .collect();
    artifacts.sort((a, b) => b.createdAt - a.createdAt);
    return artifacts.map((a) => ({
      id: a._id as Id<'releaseArtifacts'>,
      release: a.release,
      name: a.name,
      kind: a.kind,
      size: a.size,
      createdAt: a.createdAt,
    }));
  },
});
