import { describe, expect, test } from 'bun:test';
import { parseS3Env, s3ObjectKey } from '../src/s3.js';

describe('parseS3Env', () => {
  test('returns null (feature off) when no bucket is set', () => {
    expect(parseS3Env({})).toBeNull();
    expect(parseS3Env({ S3_BUCKET: '' })).toBeNull();
  });

  test('reads AWS-style settings with defaults', () => {
    const s = parseS3Env({
      S3_BUCKET: 'sveltry-blobs',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: 'AKIA',
      S3_SECRET_ACCESS_KEY: 'secret',
    })!;
    expect(s.bucket).toBe('sveltry-blobs');
    expect(s.region).toBe('us-east-1');
    expect(s.endpoint).toBeUndefined();
    expect(s.forcePathStyle).toBe(false);
    expect(s.minBytes).toBe(100 * 1024);
  });

  test('reads R2 / MinIO style with endpoint, region auto, and path style', () => {
    const s = parseS3Env({
      S3_BUCKET: 'b',
      S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
      S3_ACCESS_KEY_ID: 'k',
      S3_SECRET_ACCESS_KEY: 's',
      S3_FORCE_PATH_STYLE: 'true',
      S3_OFFLOAD_MIN_BYTES: '2048',
    })!;
    expect(s.endpoint).toBe('https://acct.r2.cloudflarestorage.com');
    expect(s.region).toBe('auto');
    expect(s.forcePathStyle).toBe(true);
    expect(s.minBytes).toBe(2048);
  });
});

describe('s3ObjectKey', () => {
  test('builds a sanitized, traversal-safe key', () => {
    expect(s3ObjectKey('artifacts', 'proj1', '1.0.0', '~/app.min.js.map')).toBe(
      'artifacts/proj1/1.0.0/app.min.js.map',
    );
    // Slashes in a part collapse to '_', so user input cannot create path segments.
    expect(s3ObjectKey('artifacts', 'p', 'r', '../../etc/passwd')).toBe(
      'artifacts/p/r/.._.._etc_passwd',
    );
  });
});
