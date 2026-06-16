import { v } from 'convex/values';
import { originalPositionFor, sourceContentFor, TraceMap } from '@jridgewell/trace-mapping';
import {
  applyOriginalPosition,
  corsHeaders,
  debugIdForRef,
  debugIdFromSourceMap,
  debugMetaImages,
  frameRef,
  ingestError,
  matchSourcemap,
  MAX_REQUEST_BODY_BYTES,
  parseDebugId,
  parseS3Env,
  parseSourceMappingURL,
  s3ObjectKey,
  type DebugMetaImage,
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
import { resolveDsnRequest } from './lib/dsnAuth';

// Blobs larger than this stay in Convex file storage (above the Node action's
// argument-size limit, which is how bytes reach the S3 upload action).
const S3_OFFLOAD_MAX_BYTES = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Upload: POST /artifacts/upload?sentry_key=<key>&o=<publicId>&release=<v>&name=<n>
// Authenticated by a DSN key, one file (raw body) per request. Used by CI / the
// `@aihxp/sveltry-sdk` uploader to publish a release's minified bundles + maps.
// ---------------------------------------------------------------------------

export const uploadArtifact = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const cors = corsHeaders(request.headers.get('origin') ?? '*');
  const params = url.searchParams;

  const release = params.get('release') ?? '';
  const name = params.get('name') ?? '';
  if (!release) return ingestError(400, 'missing release', [], cors);
  if (!name) return ingestError(400, 'missing artifact name', [], cors);

  const auth = await resolveDsnRequest(ctx, request, url, cors);
  if (!auth.ok) return auth.response;
  const resolved = auth.resolved;

  const declaredLen = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLen) && declaredLen > MAX_REQUEST_BODY_BYTES) {
    return ingestError(
      413,
      'payload too large',
      [`body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`],
      cors,
    );
  }
  const buf = await request.arrayBuffer();
  if (buf.byteLength > MAX_REQUEST_BODY_BYTES) {
    return ingestError(
      413,
      'payload too large',
      [`body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`],
      cors,
    );
  }
  const kind = name.endsWith('.map') ? ('sourcemap' as const) : ('minified' as const);

  // Extract the artifact's debug id (and, for minified files, its sourceMappingURL)
  // so the resolver can match frames by stable identity, not just path/release.
  let sourceMappingURL: string | undefined;
  let debugId: string | undefined;
  if (kind === 'minified') {
    const text = new TextDecoder().decode(buf);
    sourceMappingURL = parseSourceMappingURL(text) ?? undefined;
    debugId = parseDebugId(text) ?? undefined;
  } else {
    try {
      debugId = debugIdFromSourceMap(JSON.parse(new TextDecoder().decode(buf))) ?? undefined;
    } catch {
      // Not JSON (or truncated): leave the debug id unset, name matching still works.
    }
  }

  // Offload to S3/R2 when configured and the blob is large enough; otherwise keep it
  // in Convex file storage. The Node S3 action is pure (bytes in, result out); this
  // isolate function owns the bytes and all DB writes. Oversized blobs (beyond the
  // Node action's argument limit) fall back to Convex storage.
  const s3 = parseS3Env(process.env);
  let storageId: Id<'_storage'> | undefined;
  let s3Bucket: string | undefined;
  let s3Key: string | undefined;
  if (s3 && buf.byteLength >= s3.minBytes && buf.byteLength <= S3_OFFLOAD_MAX_BYTES) {
    const key = s3ObjectKey('artifacts', resolved.projectId, release, name);
    const res = await ctx.runAction(internal.storage.putObject, { key, bytes: buf });
    if (res.ok && res.bucket) {
      s3Bucket = res.bucket;
      s3Key = key;
    }
  }
  if (!s3Key) {
    storageId = await ctx.storage.store(
      new Blob([buf], { type: request.headers.get('content-type') ?? 'application/octet-stream' }),
    );
  }

  await ctx.runMutation(internal.sourcemaps.recordArtifact, {
    projectId: resolved.projectId,
    organizationId: resolved.organizationId,
    release,
    name,
    kind,
    storageId,
    s3Bucket,
    s3Key,
    size: buf.byteLength,
    sourceMappingURL,
    debugId,
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
    storageId: v.optional(v.id('_storage')),
    s3Bucket: v.optional(v.string()),
    s3Key: v.optional(v.string()),
    size: v.number(),
    sourceMappingURL: v.optional(v.string()),
    debugId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<'releaseArtifacts'>> => {
    const existing = await ctx.db
      .query('releaseArtifacts')
      .withIndex('by_project_release_name', (q) =>
        q.eq('projectId', args.projectId).eq('release', args.release).eq('name', args.name),
      )
      .first();
    if (existing) {
      // Drop the old bytes wherever they live (Convex storage or S3).
      if (existing.storageId) await ctx.storage.delete(existing.storageId);
      if (existing.s3Bucket && existing.s3Key) {
        await ctx.scheduler.runAfter(0, internal.storage.deleteObject, {
          bucket: existing.s3Bucket,
          key: existing.s3Key,
        });
      }
      await ctx.db.patch(existing._id, {
        kind: args.kind,
        storageId: args.storageId,
        s3Bucket: args.s3Bucket,
        s3Key: args.s3Key,
        size: args.size,
        sourceMappingURL: args.sourceMappingURL,
        debugId: args.debugId,
        createdAt: Date.now(),
      });
      return existing._id;
    }
    return ctx.db.insert('releaseArtifacts', { ...args, createdAt: Date.now() });
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

/** A source map's bytes location: either Convex file storage or an offloaded S3 object. */
interface MapSource {
  storageId?: Id<'_storage'>;
  s3Bucket?: string;
  s3Key?: string;
}

export const sourcemapsForRelease = internalQuery({
  args: { projectId: v.id('projects'), release: v.string() },
  handler: async (ctx, { projectId, release }) => {
    const artifacts = await ctx.db
      .query('releaseArtifacts')
      .withIndex('by_project_release', (q) => q.eq('projectId', projectId).eq('release', release))
      .collect();
    return artifacts
      .filter((a) => a.kind === 'sourcemap')
      .map((a) => ({ name: a.name, storageId: a.storageId, s3Bucket: a.s3Bucket, s3Key: a.s3Key }));
  },
});

/** Source maps whose embedded debug id is in `debugIds`, across any release. */
export const sourcemapsByDebugId = internalQuery({
  args: { projectId: v.id('projects'), debugIds: v.array(v.string()) },
  handler: async (ctx, { projectId, debugIds }) => {
    const out: (MapSource & { debugId: string })[] = [];
    const seen = new Set<string>();
    for (const debugId of debugIds) {
      if (seen.has(debugId)) continue;
      seen.add(debugId);
      const rows = await ctx.db
        .query('releaseArtifacts')
        .withIndex('by_project_debugid', (q) => q.eq('projectId', projectId).eq('debugId', debugId))
        .collect();
      const map = rows.find((r) => r.kind === 'sourcemap');
      if (map)
        out.push({ debugId, storageId: map.storageId, s3Bucket: map.s3Bucket, s3Key: map.s3Key });
    }
    return out;
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
    if (!event) return;

    const values = exceptionValues(event.payload);
    const hasMinified = values.some((ex) =>
      (ex.stacktrace?.frames ?? []).some(
        (f) => typeof f.lineno === 'number' && typeof f.colno === 'number',
      ),
    );
    if (!hasMinified) return;

    // Debug-id maps (matched by the event's debug_meta images, release-independent)
    // take precedence; release+name maps are the fallback for SDKs without debug ids.
    const images: DebugMetaImage[] = debugMetaImages(
      (event.payload.debug_meta as { images?: unknown[] } | undefined)?.images,
    );
    const referencedDebugIds = [
      ...new Set(images.map((i) => i.debug_id).filter((d): d is string => !!d)),
    ];

    const debugIdMaps = referencedDebugIds.length
      ? await ctx.runQuery(internal.sourcemaps.sourcemapsByDebugId, {
          projectId: event.projectId,
          debugIds: referencedDebugIds,
        })
      : [];

    const releaseMaps = event.release
      ? await ctx.runQuery(internal.sourcemaps.sourcemapsForRelease, {
          projectId: event.projectId,
          release: event.release,
        })
      : [];

    if (debugIdMaps.length === 0 && releaseMaps.length === 0) return;

    const mapNames = releaseMaps.map((m) => m.name);
    const sourceByName = new Map<string, MapSource>(releaseMaps.map((m) => [m.name, m]));
    const sourceByDebugId = new Map<string, MapSource>(debugIdMaps.map((m) => [m.debugId, m]));

    // Lazily load + parse each map at most once per run, keyed by its location (a map
    // may be reached by either debug id or name). Convex blobs load directly; offloaded
    // blobs load via a Node action (the S3 SDK can't run in this isolate).
    // `@jridgewell/trace-mapping` is pure JS (no `eval`/`new Function`).
    const tracers = new Map<string, TraceMap | null>();
    const cacheKey = (src: MapSource): string =>
      src.s3Key ? `s3:${src.s3Bucket}/${src.s3Key}` : String(src.storageId);
    const tracerFor = async (src: MapSource): Promise<TraceMap | null> => {
      const key = cacheKey(src);
      if (tracers.has(key)) return tracers.get(key) ?? null;
      let tracer: TraceMap | null = null;
      try {
        let text: string | null = null;
        if (src.s3Bucket && src.s3Key) {
          text = await ctx.runAction(internal.storage.getObjectText, {
            bucket: src.s3Bucket,
            key: src.s3Key,
          });
        } else if (src.storageId) {
          const blob = await ctx.storage.get(src.storageId);
          text = blob ? await blob.text() : null;
        }
        if (text) tracer = new TraceMap(JSON.parse(text));
      } catch (err) {
        // A corrupt/unparseable map silently no-ops symbolication; log it so an
        // operator can tell why a frame did not resolve, instead of guessing.
        console.warn(
          `sourcemap load/parse failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
        );
        tracer = null;
      }
      tracers.set(key, tracer);
      return tracer;
    };

    // Pick the source map that resolves this frame, debug id first.
    const mapForFrame = (ref: string): MapSource | null => {
      const debugId = debugIdForRef(ref, images);
      if (debugId && sourceByDebugId.has(debugId)) return sourceByDebugId.get(debugId)!;
      const name = mapNames.length ? matchSourcemap(ref, mapNames) : null;
      return name ? (sourceByName.get(name) ?? null) : null;
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
        const src = mapForFrame(ref);
        if (!src) continue;
        const tracer = await tracerFor(src);
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
      debugId: a.debugId ?? null,
      storage: a.s3Key ? ('s3' as const) : ('convex' as const),
      createdAt: a.createdAt,
    }));
  },
});
