import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'crypto';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const ARCHIVE_BUCKET = process.env.ARCHIVE_BUCKET as string;
const REGION = process.env.AWS_REGION ?? 'eu-west-1';
const MANIFEST_KEY = 'index/manifest.json';
const MANIFEST_CACHE_TTL_MS = 120_000;  // module-scope cache: manifest changes at most every 3h
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

let _manifestCache: { data: Manifest; ts: number } | null = null;

async function loadManifest(): Promise<Manifest> {
  // Module-scope cache persists across warm invocations on the same container.
  if (_manifestCache && (Date.now() - _manifestCache.ts) < MANIFEST_CACHE_TTL_MS) {
    return _manifestCache.data;
  }
  const obj = await s3.send(new GetObjectCommand({ Bucket: ARCHIVE_BUCKET, Key: MANIFEST_KEY }));
  const body = await obj.Body!.transformToString();
  const manifest = JSON.parse(body) as Manifest;
  _manifestCache = { data: manifest, ts: Date.now() };
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

  try {
    const manifest = await loadManifest();

    // Presign all warm hits in parallel rather than sequentially.
    const entries = await Promise.all(urls.map(async (url) => {
      const entry = manifest.entries[urlHash(url)];
      if (!entry) return [url, { archived: false }] as const;
      if (isCold(entry.captured_at)) {
        return [url, { archived: true, cold: true, id: urlHash(url), captured_at: entry.captured_at, domain: entry.domain }] as const;
      }
      const [screenshot, text] = await Promise.all([
        presign(entry.screenshot_key),
        entry.text_key ? presign(entry.text_key) : Promise.resolve(null),
      ]);
      return [url, {
        archived: true,
        cold: false,
        id: urlHash(url),
        captured_at: entry.captured_at,
        domain: entry.domain,
        screenshot,
        text,
        text_len: entry.text_len,
        image_sha256: entry.image_sha256,
        text_sha256: entry.text_sha256,
      }] as const;
    }));

    const result: Record<string, any> = Object.fromEntries(entries);

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
  }
};
