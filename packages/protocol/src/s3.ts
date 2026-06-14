/**
 * S3 / R2 storage-offload configuration. The actual upload/download runs in a
 * Convex Node action (the AWS SDK cannot run in the V8 isolate); this module holds
 * only the pure, unit-tested parts: reading the deployment env into a settings
 * object (or null when the feature is off) and building object keys.
 *
 * Offload is OPTIONAL: when `S3_BUCKET` is unset, `parseS3Env` returns null and the
 * caller falls back to Convex file storage, so existing self-hosters are unaffected.
 */

export interface S3Settings {
  bucket: string;
  region: string;
  /** Set for S3-compatible providers (Cloudflare R2, MinIO); unset for AWS S3. */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Required for MinIO and convenient for R2; off for AWS S3 virtual-host style. */
  forcePathStyle: boolean;
  /** Blobs at least this many bytes are offloaded; smaller ones stay in Convex. */
  minBytes: number;
}

const DEFAULT_MIN_BYTES = 100 * 1024;

/**
 * Parse S3/R2 settings from a deployment env map. Returns null (feature disabled)
 * when `S3_BUCKET` is empty. `S3_REGION` defaults to `auto` (correct for R2);
 * `S3_ENDPOINT` is set for R2/MinIO and left unset for AWS S3.
 */
export function parseS3Env(env: Record<string, string | undefined>): S3Settings | null {
  const bucket = env.S3_BUCKET?.trim();
  if (!bucket) return null;
  const minRaw = Number(env.S3_OFFLOAD_MIN_BYTES);
  return {
    bucket,
    region: env.S3_REGION?.trim() || 'auto',
    endpoint: env.S3_ENDPOINT?.trim() || undefined,
    accessKeyId: env.S3_ACCESS_KEY_ID?.trim() ?? '',
    secretAccessKey: env.S3_SECRET_ACCESS_KEY?.trim() ?? '',
    forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? '').trim().toLowerCase() === 'true',
    minBytes: Number.isFinite(minRaw) && minRaw > 0 ? minRaw : DEFAULT_MIN_BYTES,
  };
}

/**
 * A deterministic, filesystem-safe object key. Parts are sanitized so a stack-frame
 * artifact name like `~/app.min.js.map` cannot produce path traversal or odd keys.
 */
export function s3ObjectKey(prefix: string, ...parts: string[]): string {
  const clean = parts
    .map((p) => p.replace(/^[~/]+/, '').replace(/[^a-zA-Z0-9._-]+/g, '_'))
    .filter(Boolean)
    .join('/');
  return `${prefix}/${clean}`;
}
