import type { SentryProfile } from '@sveltry/types';

/** Normalized profile metadata distilled from a `profile` item. */
export interface NormalizedProfile {
  profileId: string;
  transactionName: string;
  platform: string;
  release?: string;
  environment: string;
  sampleCount: number;
  durationMs: number;
  timestamp: number;
}

function toMs(ts: number | string | undefined, fallback: number): number {
  if (ts == null) return fallback;
  if (typeof ts === 'number') return ts > 1e12 ? Math.round(ts) : Math.round(ts * 1000);
  const p = Date.parse(ts);
  return Number.isNaN(p) ? fallback : p;
}

/** Distill a `profile` item into searchable metadata (the payload is kept whole). */
export function normalizeProfile(
  payload: SentryProfile,
  opts: { receivedAt?: number } = {},
): NormalizedProfile {
  const now = opts.receivedAt ?? 0;
  const samples = payload.profile?.samples ?? [];
  let maxNs = 0;
  for (const s of samples) {
    if (typeof s.elapsed_since_start_ns === 'number' && s.elapsed_since_start_ns > maxNs) {
      maxNs = s.elapsed_since_start_ns;
    }
  }
  return {
    profileId: payload.event_id ?? '',
    transactionName:
      payload.transaction?.name ?? payload.transactions?.[0]?.name ?? '<unknown transaction>',
    platform: payload.platform ?? 'other',
    release: payload.release,
    environment: payload.environment ?? 'production',
    sampleCount: samples.length,
    durationMs: Math.round(maxNs / 1e6),
    timestamp: toMs(payload.timestamp, now),
  };
}

/** A flamegraph node: a frame with its sample count and child frames. */
export interface FlameNode {
  name: string;
  file?: string;
  inApp: boolean;
  /** Number of samples passing through this frame. */
  value: number;
  children: FlameNode[];
}

interface MutNode {
  name: string;
  file?: string;
  inApp: boolean;
  value: number;
  children: Map<string, MutNode>;
}

/**
 * Build a flamegraph tree from a Sentry profile's samples/stacks/frames. Each
 * sample's stack (leaf-first) is walked root-first into a call tree; `value` is
 * the number of samples through a frame. Children below `minFraction` of the
 * total are pruned to keep the tree renderable.
 */
export function buildFlamegraph(
  profile: SentryProfile['profile'],
  opts: { minFraction?: number; maxDepth?: number } = {},
): FlameNode {
  const samples = profile?.samples ?? [];
  const stacks = profile?.stacks ?? [];
  const frames = profile?.frames ?? [];
  const maxDepth = opts.maxDepth ?? 128;
  const root: MutNode = { name: 'all', inApp: true, value: 0, children: new Map() };

  for (const s of samples) {
    const stack = stacks[s.stack_id];
    if (!stack) continue;
    root.value += 1;
    let node = root;
    const depth = Math.min(stack.length, maxDepth);
    for (let i = stack.length - 1; i >= stack.length - depth; i--) {
      const f = frames[stack[i]!];
      const name = (f?.function || f?.module || '?').toString();
      const file = f?.filename;
      const key = `${name}@${file ?? ''}`;
      let child = node.children.get(key);
      if (!child) {
        child = { name, file, inApp: f?.in_app ?? false, value: 0, children: new Map() };
        node.children.set(key, child);
      }
      child.value += 1;
      node = child;
    }
  }

  const minSamples = Math.max(1, Math.floor(root.value * (opts.minFraction ?? 0)));
  const finalize = (n: MutNode): FlameNode => ({
    name: n.name,
    file: n.file,
    inApp: n.inApp,
    value: n.value,
    children: [...n.children.values()]
      .filter((c) => c.value >= minSamples)
      .sort((a, b) => b.value - a.value)
      .map(finalize),
  });
  return finalize(root);
}
