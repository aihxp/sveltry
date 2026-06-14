'use node';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { v } from 'convex/values';
import { parseS3Env, type S3Settings } from '@sveltry/protocol';
import { internalAction } from './_generated/server';

/**
 * Optional S3 / R2 blob offload. Runs in the Convex Node runtime (`use node`) so it
 * can use the AWS SDK, which cannot run in the V8 isolate. Configured entirely by
 * deployment env vars; when `S3_BUCKET` is unset, every action is a clean no-op and
 * blobs stay in Convex file storage, so existing instances are unaffected.
 *
 * These actions are PURE compute: bytes/keys in, result out. The calling isolate
 * function owns all DB and Convex-file-storage access, so the Node runtime never
 * needs to call back into the backend.
 *
 * Env (set with `npx convex env set ...`):
 *  - S3_BUCKET                 bucket name (unset = offload disabled)
 *  - S3_REGION                 default "auto" (correct for R2)
 *  - S3_ENDPOINT               set for R2 / MinIO; unset for AWS S3
 *  - S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
 *  - S3_FORCE_PATH_STYLE       "true" for MinIO (and fine for R2)
 *  - S3_OFFLOAD_MIN_BYTES      blobs >= this are offloaded (default 102400)
 */

function s3Client(s: S3Settings): S3Client {
  return new S3Client({
    region: s.region,
    endpoint: s.endpoint,
    forcePathStyle: s.forcePathStyle,
    credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
  });
}

/** Upload bytes to the configured bucket under `key`. Returns the bucket on success. */
export const putObject = internalAction({
  args: { key: v.string(), bytes: v.bytes() },
  handler: async (_ctx, { key, bytes }): Promise<{ ok: boolean; bucket: string | null }> => {
    const s = parseS3Env(process.env);
    if (!s) return { ok: false, bucket: null };
    await s3Client(s).send(
      new PutObjectCommand({ Bucket: s.bucket, Key: key, Body: new Uint8Array(bytes) }),
    );
    return { ok: true, bucket: s.bucket };
  },
});

/** Fetch an offloaded object's text (used to load an offloaded source map). */
export const getObjectText = internalAction({
  args: { bucket: v.string(), key: v.string() },
  handler: async (_ctx, { bucket, key }): Promise<string | null> => {
    const s = parseS3Env(process.env);
    if (!s) return null;
    const res = await s3Client(s).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return res.Body ? await res.Body.transformToString() : null;
  },
});

/** Delete an offloaded object (on artifact replacement / cleanup). */
export const deleteObject = internalAction({
  args: { bucket: v.string(), key: v.string() },
  handler: async (_ctx, { bucket, key }) => {
    const s = parseS3Env(process.env);
    if (!s) return;
    await s3Client(s).send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  },
});
