import { createClient } from "redis";;

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

let _client: ReturnType<typeof createClient> | null = null;
async function getRedis() {
  if (_client && _client.isOpen) return _client;
  _client = createClient({ url: process.env.REDIS_URL!, socket: { tls: true } });
  await _client.connect();
  return _client;
}

const NEGATIVE_WORDS = ['killed','murdered','stabbed','attacked','assault','hate crime','violence','dead','death','fatal','banned','blocked','denied','rejected','stripped','criminalised','criminalized','illegal','outlawed','prohibited','conversion therapy','subpoena','persecution','discrimination','anti-trans','transphobic','transphobia','gender ideology','bathroom bill','setback','crisis','danger','threat','executed','targeting','expelled','fired'];
const POSITIVE_WORDS = ['wins','victory','won','approved','passed','signed','upheld','recognised','recognized','protected','landmark','historic','breakthrough','access','available','covered','funded','celebrates','celebration','pride','milestone','first trans','elected','appointed','honoured','honored','award','inclusion','welcomed','supported','progress','reform','improvement','recognition','self-identification'];

const OUTLET_TYPES: Record<string, string> = {
  'Daily Mail': 'uk-tabloid', 'The Sun': 'uk-tabloid', 'Daily Express': 'uk-tabloid', 'The Mirror': 'uk-tabloid', 'Metro': 'uk-tabloid',
  'BBC News': 'uk-broadsheet', 'BBC Trans Coverage': 'uk-broadsheet', 'The Guardian': 'uk-broadsheet', 'Guardian Trans': 'uk-broadsheet',
  'The Independent': 'uk-broadsheet', 'The Times': 'uk-broadsheet', 'The Telegraph': 'uk-broadsheet', 'Sky News': 'uk-broadsheet',
  'Channel 4 News': 'uk-broadsheet', 'ITV News': 'uk-broadsheet', 'The Scotsman': 'scottish', 'Herald Scotland': 'scottish',
  'Reuters LGBT': 'international', 'Reuters Trans Coverage': 'international', 'NYT Trans Coverage': 'international',
  'Washington Post Trans': 'international', 'LatAm Trans Rights': 'international', 'Asia-Pacific Trans News': 'international',
  'Lambda Legal': 'advocacy', 'ACLU LGBT News': 'advocacy', 'ILGA World': 'advocacy', 'TGEU (Europe)': 'advocacy',
  'HRC Violence Tracker': 'advocacy', 'Gender Analysis': 'advocacy',
  'Trans Legislation Tracker': 'legal', 'UK Trans Law': 'legal', 'UK Trans Safety': 'legal',
  'US Trans Legislation': 'legal', 'EU Gender Recognition': 'legal', 'Puberty Blocker Rulings': 'legal',
  'Trans Healthcare Access': 'healthcare', 'Cass Review Coverage': 'healthcare', 'WPATH News': 'healthcare',
  'Trans Violence News': 'safety', 'TDoR / TDoV Coverage': 'safety',
  'PinkNews': 'trans-media', 'LGBTQ Nation': 'trans-media', 'Them': 'trans-media', 'Autostraddle': 'trans-media',
  'Erin in the Morning': 'trans-media', 'Xtra Magazine': 'trans-media', 'The 19th': 'trans-media',
};

type SentimentLabel = 'positive' | 'negative' | 'neutral';

function scoreBatch(items: Array<{ title: string; source?: string }>) {
  return items.map(item => {
    const lower = item.title.toLowerCase();
    let score = 0;
    for (const w of NEGATIVE_WORDS) if (lower.includes(w)) score -= 1;
    for (const w of POSITIVE_WORDS) if (lower.includes(w)) score += 1;
    const label: SentimentLabel = score < -0.5 ? 'negative' : score > 0.5 ? 'positive' : 'neutral';
    return { label, source: item.source };
  });
}

const SNAPSHOT_KEY = (variant: string) => `news:sentiment:v1:${variant}`;
const SNAPSHOT_TTL = 60 * 60 * 24 * 30;

async function getHistory(variant: string) {
  try {
    const redis = await getRedis();
    const raw = await redis.get(SNAPSHOT_KEY(variant));
    if (!raw) return [];
    return JSON.parse(raw);
  } catch { return []; }
}

async function saveHistory(variant: string, history: unknown[]) {
  try {
    const redis = await getRedis();
    await redis.set(SNAPSHOT_KEY(variant), JSON.stringify(history), { EX: SNAPSHOT_TTL });
  } catch {}
}

export async function recordSentimentSnapshot(variant: string, items: Array<{ title: string; source?: string }>) {
  if (items.length === 0) return;
  const scores = scoreBatch(items);
  const positive = scores.filter(s => s.label === 'positive').length;
  const negative = scores.filter(s => s.label === 'negative').length;
  const neutral = scores.length - positive - negative;
  const total = scores.length;

  const byType: Record<string, { positive: number; negative: number; neutral: number; total: number }> = {};
  scores.forEach(s => {
    const t = OUTLET_TYPES[s.source ?? ''] ?? 'other';
    if (!byType[t]) byType[t] = { positive: 0, negative: 0, neutral: 0, total: 0 };
    byType[t].total++;
    byType[t][s.label]++;
  });

  const today = new Date().toISOString().slice(0, 10);
  const snapshot = {
    date: today, positive, negative, neutral, total,
    ratio: total > 0 ? positive / total : 0.5,
    outletBreakdown: Object.entries(byType).map(([type, v]) => ({ type, ...v })),
  };

  const history = await getHistory(variant);
  const filtered = history.filter((h: { date: string }) => h.date !== today);
  filtered.push(snapshot);
  filtered.sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date));
  await saveHistory(variant, filtered.slice(-30));
}

export const handler = async (event: {
  requestContext?: { http?: { method?: string } };
  queryStringParameters?: Record<string, string>;
  body?: string;
}) => {
  const method = event.requestContext?.http?.method ?? 'GET';

  if (method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const variant = event.queryStringParameters?.variant ?? 'trans';
  const days = Math.min(30, parseInt(event.queryStringParameters?.days ?? '14', 10));

  if (method === 'POST') {
    try {
      const body = JSON.parse(event.body ?? '{}') as { variant?: string; items?: Array<{ title: string; source?: string }> };
      const v = body.variant ?? variant;
      const items = body.items ?? [];
      await recordSentimentSnapshot(v, items);
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, count: items.length }) };
    } catch (err) {
      return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: String(err) }) };
    }
  }

  try {
    const history = await getHistory(variant);
    const trimmed = history.slice(-days);
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }, body: JSON.stringify({ history: trimmed, variant }) };
  } catch {
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ history: [], variant }) };
  }
};