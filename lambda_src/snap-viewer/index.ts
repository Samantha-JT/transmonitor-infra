import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const ARCHIVE_BUCKET = process.env.ARCHIVE_BUCKET as string;
const REGION = process.env.AWS_REGION ?? 'eu-west-1';
const MANIFEST_KEY = 'index/manifest.json';
const MANIFEST_CACHE_TTL_MS = 120_000;
const GLACIER_DAYS = 90;

// JPEGs are content-addressed by URL hash, so the bytes at a given key never
// change. Tell CDN + browser to cache for a year.
const IMAGE_CACHE_HEADER = 'public, max-age=31536000, immutable';
// HTML viewer pages are also derived from the manifest entry; cache briefly
// to absorb hot links, but short enough that captured_at updates are visible.
const HTML_CACHE_HEADER = 'public, max-age=300';

const s3 = new S3Client({ region: REGION });

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
  if (_manifestCache && Date.now() - _manifestCache.ts < MANIFEST_CACHE_TTL_MS) {
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
  return Date.now() - t > GLACIER_DAYS * 86400_000;
}

// Reject anything that's not a 16-char hex string — the only id format we hand out.
function isValidId(id: string): boolean {
  return /^[a-f0-9]{16}$/.test(id);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso: string): string {
  // "2026-06-19T18:46:33.317083" -> "19 Jun 2026, 18:46 UTC"
  try {
    const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
    return d.toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
    }) + ' UTC';
  } catch {
    return iso;
  }
}

function renderViewerHtml(id: string, entry: ManifestEntry): string {
  const title = entry.url.length > 120 ? entry.url.slice(0, 117) + '...' : entry.url;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Snapshot — ${escapeHtml(entry.domain)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #111; color: #ddd; font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  header { padding: 12px 16px; border-bottom: 1px solid #2a2a2a; background: #161616; position: sticky; top: 0; z-index: 1; }
  header .domain { font-weight: 600; color: #fff; }
  header .meta { font-size: 12px; color: #888; margin-top: 4px; word-break: break-all; }
  header a { color: #6cf; text-decoration: none; }
  header a:hover { text-decoration: underline; }
  main { max-width: 1280px; margin: 0 auto; padding: 16px; }
  img { display: block; width: 100%; height: auto; box-shadow: 0 4px 24px rgba(0,0,0,0.5); border-radius: 4px; }
  .cold { padding: 32px 16px; text-align: center; color: #aaa; }
  .cold h2 { color: #fff; margin: 0 0 8px; }
</style>
</head>
<body>
<header>
  <div class="domain">${escapeHtml(entry.domain)}</div>
  <div class="meta">
    Captured ${escapeHtml(formatDate(entry.captured_at))} ·
    <a href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer">View original ↗</a>
  </div>
</header>
<main>
  <img src="/snap/${id}/image" alt="Snapshot of ${escapeHtml(title)}" loading="eager">
</main>
</body>
</html>`;
}

function renderColdHtml(entry: ManifestEntry): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Snapshot — archived</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; background: #111; color: #ddd; font: 14px/1.5 -apple-system, system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; }
  .box { max-width: 480px; padding: 32px; text-align: center; }
  h1 { color: #fff; font-size: 20px; margin: 0 0 12px; }
  p { margin: 8px 0; color: #aaa; }
  a { color: #6cf; }
</style>
</head>
<body>
<div class="box">
  <h1>🧊 Snapshot in cold storage</h1>
  <p>This snapshot from <strong>${escapeHtml(entry.domain)}</strong> was captured ${escapeHtml(formatDate(entry.captured_at))} and has been moved to Glacier.</p>
  <p><a href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer">View original article ↗</a></p>
</div>
</body>
</html>`;
}

function notFound(message = 'Snapshot not found'): any {
  return {
    statusCode: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: message,
  };
}

export const handler = async (event: any) => {
  // API Gateway v2 path params live at event.pathParameters
  const id = (event?.pathParameters?.id ?? '').toLowerCase();
  const rawPath = event?.rawPath ?? event?.requestContext?.http?.path ?? '';
  const isImageRequest = rawPath.endsWith('/image');

  if (!isValidId(id)) return notFound('Invalid snapshot id');

  let manifest: Manifest;
  try {
    manifest = await loadManifest();
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: 'Failed to load manifest',
    };
  }

  const entry = manifest.entries[id];
  if (!entry) return notFound();

  if (isImageRequest) {
    if (isCold(entry.captured_at)) {
      return {
        statusCode: 410,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: 'Snapshot is in cold storage',
      };
    }
    // Stream the JPEG bytes through Lambda. With 256MB memory and typical
    // snapshots under 1MB this is well within limits.
    try {
      const obj = await s3.send(new GetObjectCommand({
        Bucket: ARCHIVE_BUCKET,
        Key: entry.screenshot_key,
      }));
      const bytes = await obj.Body!.transformToByteArray();
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': IMAGE_CACHE_HEADER,
          'Content-Length': String(bytes.length),
        },
        body: Buffer.from(bytes).toString('base64'),
        isBase64Encoded: true,
      };
    } catch (err) {
      return notFound('Snapshot image missing');
    }
  }

  // HTML viewer page
  const html = isCold(entry.captured_at)
    ? renderColdHtml(entry)
    : renderViewerHtml(id, entry);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': HTML_CACHE_HEADER,
    },
    body: html,
  };
};
