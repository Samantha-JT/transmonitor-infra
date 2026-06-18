import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createClient } from 'redis';
import { createHash } from 'crypto';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const ARCHIVE_BUCKET = process.env.ARCHIVE_BUCKET as string;
const REGION = process.env.AWS_REGION ?? 'eu-west-1';
const MANIFEST_KEY = 'index/manifest.json';
const MANIFEST_CACHE_KEY = 'archive:manifest:v1';
const MANIFEST_CACHE_TTL = 120;        // seconds — manifest changes at most every 3h
const PRESIGN_TTL = 3600;              // 1h signed-URL validity
const GLACIER_DAYS = 90;               // matches the S3 lifecycle transition

const s3 = new S3Client({ region: REGION });

// url_hash must match archiver.py: sha256(url)[:16]
function urlHash(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

interface ManifestEntry {
  url: string;
  domain: string;
  screenshot_key: string;
  text_key: string | null;
  captured_at: string;
  image_sha256: string | null;
  text_sha256: string | null;
  text_len: number;
}
interface Manifest {
  generated_at: string;
  count: number;
  entries: Record<string, ManifestEntry>;
}

async function loadManifest(redis: ReturnType<typeof createClient>): Promise<Manifest> {
  // Try Redis cache first.
  try {
    const cached = await redis.get(MANIFEST_CACHE_KEY);
    if (cached) return JSON.parse(cached) as Manifest;
  } catch { /* fall through to S3 */ }

  const obj = await s3.send(new GetObjectCommand({ Bucket: ARCHIVE_BUCKET, Key: MANIFEST_KEY }));
  const body = await obj.Body!.transformToString();
  const manifest = JSON.parse(body) as Manifest;

  try {
    await redis.set(MANIFEST_CACHE_KEY, body, { EX: MANIFEST_CACHE_TTL });
  } catch { /* cache write best-effort */ }

  return manifest;
}

function isCold(capturedAt: string): boolean {
  const t = Date.parse(capturedAt);
  if (Number.isNaN(t)) return false;
  return (Date.now() - t) > GLACIER_DAYS * 86400_000;
}

async function presign(key: string): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: ARCHIVE_BUCKET, Key: key }), { expiresIn: PRESIGN_TTL });
}

export const handler = async (event: any) => {
  if (event?.requestContext?.http?.method === 'OPTIONS' || event?.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  let urls: string[] = [];
  try {
    const parsed = JSON.parse(event?.body ?? '{}');
    urls = Array.isArray(parsed.urls) ? parsed.urls.filter((u: unknown) => typeof u === 'string') : [];
  } catch {
    return { statusCode: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'invalid body' }) };
  }
  if (urls.length === 0) {
    return { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify({}) };
  }
  // Cap to protect the function from oversized requests.
  urls = urls.slice(0, 200);

  let redis: ReturnType<typeof createClient> | null = null;
  try {
    redis = createClient({ url: process.env.REDIS_URL });
    await redis.connect().catch(() => { redis = null; });

    const manifest = await loadManifest(redis ?? ({ get: async () => null, set: async () => null } as any));

    const result: Record<string, any> = {};
    for (const url of urls) {
      const entry = manifest.entries[urlHash(url)];
      if (!entry) { result[url] = { archived: false }; continue; }
      if (isCold(entry.captured_at)) {
        result[url] = { archived: true, cold: true, captured_at: entry.captured_at, domain: entry.domain };
        continue;
      }
      result[url] = {
        archived: true,
        cold: false,
        captured_at: entry.captured_at,
        domain: entry.domain,
        screenshot: await presign(entry.screenshot_key),
        text: entry.text_key ? await presign(entry.text_key) : null,
        text_len: entry.text_len,
        image_sha256: entry.image_sha256,
        text_sha256: entry.text_sha256,
      };
    }

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: (err as Error).message }),
    };
  } finally {
    if (redis) await redis.disconnect().catch(() => {});
  }
};
