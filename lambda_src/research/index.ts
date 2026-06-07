import { createClient } from "redis";;

let client: ReturnType<typeof createClient> | null = null;
async function getClient() {
  if (client && client.isOpen) return client;
  client = createClient({ url: process.env.REDIS_URL!, socket: { tls: true } });
  await client.connect();
  return client;
}

async function redisGet(key: string): Promise<unknown> {
  const redis = await getClient();
  const raw = await redis.get(key);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (parsed && typeof parsed === 'object' && '_seed' in parsed && 'data' in parsed) return (parsed as any).data;
  return parsed;
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-origin-verify' };
const ok = (body: unknown, ttl = 300) => ({ statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}, stale-while-revalidate=60` }, body: JSON.stringify(body) });

const CURATED_EVENTS = [
  { id: 'web-summit-2026', title: 'Web Summit 2026', type: 'conference', location: 'Lisbon, Portugal', coords: { lat: 38.7223, lng: -9.1393, country: 'Portugal', original: 'Lisbon, Portugal', virtual: false }, startDate: '2026-11-02', endDate: '2026-11-05', url: 'https://websummit.com', source: 'curated', description: 'World premier tech conference' },
  { id: 'collision-2026', title: 'Collision 2026', type: 'conference', location: 'Toronto, Canada', coords: { lat: 43.6532, lng: -79.3832, country: 'Canada', original: 'Toronto, Canada', virtual: false }, startDate: '2026-06-22', endDate: '2026-06-25', url: 'https://collisionconf.com', source: 'curated', description: 'North Americas fastest growing tech conference' },
  { id: 'gitex-global-2026', title: 'GITEX Global 2026', type: 'conference', location: 'Dubai, UAE', coords: { lat: 25.2048, lng: 55.2708, country: 'UAE', original: 'Dubai, UAE', virtual: false }, startDate: '2026-12-07', endDate: '2026-12-11', url: 'https://www.gitex.com', source: 'curated', description: 'Worlds largest tech and startup show' },
];

const CITY_COORDS: Record<string, { lat: number; lng: number; country: string; virtual?: boolean }> = {
  'san francisco': { lat: 37.7749, lng: -122.4194, country: 'USA' }, 'new york': { lat: 40.7128, lng: -74.0060, country: 'USA' },
  'london': { lat: 51.5074, lng: -0.1278, country: 'UK' }, 'berlin': { lat: 52.5200, lng: 13.4050, country: 'Germany' },
  'paris': { lat: 48.8566, lng: 2.3522, country: 'France' }, 'amsterdam': { lat: 52.3676, lng: 4.9041, country: 'Netherlands' },
  'singapore': { lat: 1.3521, lng: 103.8198, country: 'Singapore' }, 'dubai': { lat: 25.2048, lng: 55.2708, country: 'UAE' },
  'tokyo': { lat: 35.6762, lng: 139.6503, country: 'Japan' }, 'toronto': { lat: 43.6532, lng: -79.3832, country: 'Canada' },
  'lisbon': { lat: 38.7223, lng: -9.1393, country: 'Portugal' }, 'austin': { lat: 30.2672, lng: -97.7431, country: 'USA' },
  'seattle': { lat: 47.6062, lng: -122.3321, country: 'USA' }, 'las vegas': { lat: 36.1699, lng: -115.1398, country: 'USA' },
  'online': { lat: 0, lng: 0, country: 'Virtual', virtual: true },
};

function geocode(location: string): { lat: number; lng: number; country: string; original: string; virtual: boolean } | null {
  if (!location) return null;
  const norm = location.toLowerCase().trim().replace(/,\s*(usa|us|uk)$/, '');
  if (CITY_COORDS[norm]) return { ...CITY_COORDS[norm]!, original: location, virtual: CITY_COORDS[norm]!.virtual ?? false };
  for (const [key, c] of Object.entries(CITY_COORDS)) {
    if (norm.includes(key) || key.includes(norm)) return { ...c, original: location, virtual: c.virtual ?? false };
  }
  return null;
}

export const handler = async (event: { rawPath?: string; path?: string; queryStringParameters?: Record<string, string>; requestContext?: { http?: { method?: string } } }) => {
  if (event.requestContext?.http?.method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const path = event.rawPath || event.path || '';
  const qs = event.queryStringParameters || {};

  try {
    if (path.endsWith('/list-tech-events')) {
      const cached = await redisGet('research:tech-events:v1').catch(() => null) as any;
      let events: any[] = cached?.events?.length ? cached.events : [];

      if (!events.length) {
        try {
          const resp = await fetch('https://www.techmeme.com/newsy_events.ics', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
          if (resp.ok) {
            const text = await resp.text();
            for (const block of text.split('BEGIN:VEVENT').slice(1)) {
              const summary = block.match(/SUMMARY:(.+)/)?.[1]?.trim();
              const location = block.match(/LOCATION:(.+)/)?.[1]?.trim() || '';
              const dtstart = block.match(/DTSTART;VALUE=DATE:(\d+)/)?.[1];
              const dtend = block.match(/DTEND;VALUE=DATE:(\d+)/)?.[1];
              const url = block.match(/URL:(.+)/)?.[1]?.trim() || '';
              const uid = block.match(/UID:(.+)/)?.[1]?.trim() || '';
              if (summary && dtstart) {
                const fmt = (d: string) => `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
                events.push({ id: uid, title: summary, type: location ? 'conference' : 'other', location, startDate: fmt(dtstart), endDate: fmt(dtend || dtstart), url, source: 'techmeme', description: '' });
              }
            }
          }
        } catch (e: any) { console.warn('[research] Techmeme:', e?.message); }
        const now = new Date();
        events.push(...CURATED_EVENTS.filter(e => new Date(e.startDate) >= now));
      }

      events = events.map(e => { const coords = geocode(e.location); return coords ? { ...e, coords } : e; });

      const limit = Math.min(parseInt(qs.limit || '50', 10), 200);
      const days = Math.min(parseInt(qs.days || '180', 10), 365);
      const now = new Date(); const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + days);
      events = events.filter(e => new Date(e.startDate) >= now && new Date(e.startDate) <= cutoff);
      if (qs.type && qs.type !== 'all') events = events.filter(e => e.type === qs.type);
      if (qs.mappable === 'true') events = events.filter(e => e.coords && !e.coords.virtual);
      events = events.slice(0, limit);

      const conferences = events.filter((e: any) => e.type === 'conference');
      return ok({ success: true, count: events.length, conferenceCount: conferences.length, mappableCount: conferences.filter((e: any) => e.coords && !e.coords?.virtual).length, lastUpdated: new Date().toISOString(), events, error: '' });
    }

    if (path.endsWith('/list-defense-patents')) return ok(await redisGet('research:defense-patents:v1') ?? { patents: [] });

    return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Not found' }) };
  } catch (e: any) {
    console.error('[research]', e?.message);
    return ok({ success: false, count: 0, conferenceCount: 0, mappableCount: 0, lastUpdated: new Date().toISOString(), events: [], error: e?.message });
  }
};
