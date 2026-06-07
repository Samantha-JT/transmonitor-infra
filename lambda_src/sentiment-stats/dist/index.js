var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// sentiment-stats/index.ts
var index_exports = {};
__export(index_exports, {
  handler: () => handler,
  recordSentimentSnapshot: () => recordSentimentSnapshot
});
module.exports = __toCommonJS(index_exports);
var import_redis = require("redis");
var CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
var _client = null;
async function getRedis() {
  if (_client && _client.isOpen) return _client;
  _client = (0, import_redis.createClient)({ url: process.env.REDIS_URL, socket: { tls: true } });
  await _client.connect();
  return _client;
}
var NEGATIVE_WORDS = ["killed", "murdered", "stabbed", "attacked", "assault", "hate crime", "violence", "dead", "death", "fatal", "banned", "blocked", "denied", "rejected", "stripped", "criminalised", "criminalized", "illegal", "outlawed", "prohibited", "conversion therapy", "subpoena", "persecution", "discrimination", "anti-trans", "transphobic", "transphobia", "gender ideology", "bathroom bill", "setback", "crisis", "danger", "threat", "executed", "targeting", "expelled", "fired"];
var POSITIVE_WORDS = ["wins", "victory", "won", "approved", "passed", "signed", "upheld", "recognised", "recognized", "protected", "landmark", "historic", "breakthrough", "access", "available", "covered", "funded", "celebrates", "celebration", "pride", "milestone", "first trans", "elected", "appointed", "honoured", "honored", "award", "inclusion", "welcomed", "supported", "progress", "reform", "improvement", "recognition", "self-identification"];
var OUTLET_TYPES = {
  "Daily Mail": "uk-tabloid",
  "The Sun": "uk-tabloid",
  "Daily Express": "uk-tabloid",
  "The Mirror": "uk-tabloid",
  "Metro": "uk-tabloid",
  "BBC News": "uk-broadsheet",
  "BBC Trans Coverage": "uk-broadsheet",
  "The Guardian": "uk-broadsheet",
  "Guardian Trans": "uk-broadsheet",
  "The Independent": "uk-broadsheet",
  "The Times": "uk-broadsheet",
  "The Telegraph": "uk-broadsheet",
  "Sky News": "uk-broadsheet",
  "Channel 4 News": "uk-broadsheet",
  "ITV News": "uk-broadsheet",
  "The Scotsman": "scottish",
  "Herald Scotland": "scottish",
  "Reuters LGBT": "international",
  "Reuters Trans Coverage": "international",
  "NYT Trans Coverage": "international",
  "Washington Post Trans": "international",
  "LatAm Trans Rights": "international",
  "Asia-Pacific Trans News": "international",
  "Lambda Legal": "advocacy",
  "ACLU LGBT News": "advocacy",
  "ILGA World": "advocacy",
  "TGEU (Europe)": "advocacy",
  "HRC Violence Tracker": "advocacy",
  "Gender Analysis": "advocacy",
  "Trans Legislation Tracker": "legal",
  "UK Trans Law": "legal",
  "UK Trans Safety": "legal",
  "US Trans Legislation": "legal",
  "EU Gender Recognition": "legal",
  "Puberty Blocker Rulings": "legal",
  "Trans Healthcare Access": "healthcare",
  "Cass Review Coverage": "healthcare",
  "WPATH News": "healthcare",
  "Trans Violence News": "safety",
  "TDoR / TDoV Coverage": "safety",
  "PinkNews": "trans-media",
  "LGBTQ Nation": "trans-media",
  "Them": "trans-media",
  "Autostraddle": "trans-media",
  "Erin in the Morning": "trans-media",
  "Xtra Magazine": "trans-media",
  "The 19th": "trans-media"
};
function scoreBatch(items) {
  return items.map((item) => {
    const lower = item.title.toLowerCase();
    let score = 0;
    for (const w of NEGATIVE_WORDS) if (lower.includes(w)) score -= 1;
    for (const w of POSITIVE_WORDS) if (lower.includes(w)) score += 1;
    const label = score < -0.5 ? "negative" : score > 0.5 ? "positive" : "neutral";
    return { label, source: item.source };
  });
}
var SNAPSHOT_KEY = (variant) => `news:sentiment:v1:${variant}`;
var SNAPSHOT_TTL = 60 * 60 * 24 * 30;
async function getHistory(variant) {
  try {
    const redis = await getRedis();
    const raw = await redis.get(SNAPSHOT_KEY(variant));
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
async function saveHistory(variant, history) {
  try {
    const redis = await getRedis();
    await redis.set(SNAPSHOT_KEY(variant), JSON.stringify(history), { EX: SNAPSHOT_TTL });
  } catch {
  }
}
async function recordSentimentSnapshot(variant, items) {
  if (items.length === 0) return;
  const scores = scoreBatch(items);
  const positive = scores.filter((s) => s.label === "positive").length;
  const negative = scores.filter((s) => s.label === "negative").length;
  const neutral = scores.length - positive - negative;
  const total = scores.length;
  const byType = {};
  scores.forEach((s) => {
    const t = OUTLET_TYPES[s.source ?? ""] ?? "other";
    if (!byType[t]) byType[t] = { positive: 0, negative: 0, neutral: 0, total: 0 };
    byType[t].total++;
    byType[t][s.label]++;
  });
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const snapshot = {
    date: today,
    positive,
    negative,
    neutral,
    total,
    ratio: total > 0 ? positive / total : 0.5,
    outletBreakdown: Object.entries(byType).map(([type, v]) => ({ type, ...v }))
  };
  const history = await getHistory(variant);
  const filtered = history.filter((h) => h.date !== today);
  filtered.push(snapshot);
  filtered.sort((a, b) => a.date.localeCompare(b.date));
  await saveHistory(variant, filtered.slice(-30));
}
var handler = async (event) => {
  const method = event.requestContext?.http?.method ?? "GET";
  if (method === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const variant = event.queryStringParameters?.variant ?? "trans";
  const days = Math.min(30, parseInt(event.queryStringParameters?.days ?? "14", 10));
  if (method === "POST") {
    try {
      const body = JSON.parse(event.body ?? "{}");
      const v = body.variant ?? variant;
      const items = body.items ?? [];
      await recordSentimentSnapshot(v, items);
      return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, count: items.length }) };
    } catch (err) {
      return { statusCode: 500, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ ok: false, error: String(err) }) };
    }
  }
  try {
    const history = await getHistory(variant);
    const trimmed = history.slice(-days);
    return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=300" }, body: JSON.stringify({ history: trimmed, variant }) };
  } catch {
    return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ history: [], variant }) };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler,
  recordSentimentSnapshot
});
