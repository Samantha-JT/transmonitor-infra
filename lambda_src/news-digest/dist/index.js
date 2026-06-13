"use strict";
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

// news-digest/index.ts
var index_exports = {};
__export(index_exports, {
  handler: () => handler,
  listFeedDigest: () => listFeedDigest
});
module.exports = __toCommonJS(index_exports);
var import_redis2 = require("redis");

// news-digest/_redis.ts
var import_redis = require("redis");
var client = null;
async function getClient() {
  if (client && client.isOpen) return client;
  client = (0, import_redis.createClient)({
    url: process.env.REDIS_URL,
    socket: { tls: true }
  });
  client.on("error", (err) => console.error("Redis error:", err));
  await client.connect();
  return client;
}
async function cachedFetchJson(key, ttlSeconds, fetcher) {
  try {
    const redis = await getClient();
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);
  } catch {
  }
  const fresh = await fetcher();
  if (fresh !== null) {
    try {
      const redis = await getClient();
      await redis.set(key, JSON.stringify(fresh), { EX: ttlSeconds });
    } catch {
    }
  }
  return fresh;
}
async function getCachedJsonBatch(keys) {
  const map = /* @__PURE__ */ new Map();
  if (keys.length === 0) return map;
  try {
    const redis = await getClient();
    const values = await redis.mGet(keys);
    for (let i = 0; i < keys.length; i++) {
      const v = values[i];
      if (v) map.set(keys[i], JSON.parse(v));
    }
  } catch {
  }
  return map;
}
async function runRedisPipeline(commands, _readonly = false) {
  try {
    const redis = await getClient();
    const pipeline = redis.multi();
    for (const cmd of commands) {
      const [op, ...args] = cmd;
      pipeline[op.toLowerCase()](...args);
    }
    const results = await pipeline.exec();
    return (results ?? []).map((r) => ({ result: r }));
  } catch {
    return commands.map(() => ({ result: null }));
  }
}

// news-digest/pushover.ts
var PUSHOVER_API = "https://api.pushover.net/1/messages.json";
async function pushover({ token, user, title, message, priority = 0 }) {
  if (!token || !user) return;
  try {
    const res = await fetch(PUSHOVER_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, user, title, message, priority, html: 1 })
    });
    if (!res.ok) console.error("Pushover error:", await res.text());
  } catch (err) {
    console.error("Pushover fetch failed:", err);
  }
}

// news-digest/_hash.ts
var import_crypto = require("crypto");
async function sha256Hex(input) {
  return (0, import_crypto.createHash)("sha256").update(input).digest("hex");
}

// news-digest/_feeds.ts
var gn = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
var gnGB = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-GB&gl=GB&ceid=GB:en`;
var VARIANT_FEEDS = {
  trans: {
    legal: [
      // DISABLED 2026-06-07: persistent 404/403 in Lambda logs: { name: 'Trans Legislation Tracker', url: 'https://translegislation.com/rss.xml' },
      { name: "Law Dork", url: "https://www.lawdork.com/feed" },
      { name: "Good Law Project", url: "https://goodlawproject.org/feed/" },
      { name: "UK Trans Law", url: gnGB('("GRC" OR "Gender Recognition Act" OR "Cass Review" OR "Equality Act") UK when:3d') },
      { name: "US Trans Legislation", url: gn('("gender-affirming care ban" OR "trans bill" OR "bathroom bill" OR "drag ban") when:3d') },
      { name: "EU Gender Recognition", url: gn('("gender self-determination" OR "Ley Trans" OR "Selbstbestimmungsgesetz") when:7d') }
    ],
    healthcare: [
      { name: "Gender Analysis", url: "https://genderanalysis.net/feed/" },
      { name: "Cass Review Coverage", url: gn('("Cass Review" OR "Tavistock clinic") when:7d') },
      { name: "Trans Healthcare Access", url: gn('("transgender" OR "trans rights") ("gender-affirming care" OR "puberty blockers" OR "hormone therapy") when:3d') },
      { name: "Puberty Blocker Rulings", url: gn('"puberty blockers" (court OR ruling OR ban) when:7d') }
    ],
    community: [
      { name: "PinkNews", url: "https://www.thepinknews.com/feed/" }
    ],
    international: [
      { name: "LatAm Trans Rights", url: gn('("Ley de Identidad de Genero" OR "transgender rights" OR "travesti") when:7d') },
      { name: "Asia-Pacific Trans News", url: gn('("transgender" OR "hijra") (Thailand OR Japan OR Korea OR India) when:7d') }
    ],
    safety: [
      { name: "Trans Murder Monitoring", url: gn("site:transrespect.org when:30d") },
      { name: "TDoR / TDoV Coverage", url: gn('("Trans Day of Remembrance" OR "TDoR" OR "Trans Day of Visibility") when:30d') },
      { name: "Trans Violence News", url: gn('("transgender" OR "trans woman" OR "trans man") ("hate crime" OR "attacked" OR "murdered") when:3d') },
      { name: "UK Trans Safety", url: gnGB('("transgender" OR "trans") ("hate crime" OR "attack" OR "violence") UK when:7d') }
    ],
    "uk-press": [
      // Direct RSS feeds for media-bias sources. These reduce reliance on Google News
      // backfill and give unscored registry sources real articles to ingest/score.
      { name: "Attitude", scanAllWithBedrock: true, url: "https://www.attitude.co.uk/feed/" },
      { name: "DIVA Magazine", scanAllWithBedrock: true, url: "https://diva-magazine.com/feed/" },
      { name: "Vice UK", scanAllWithBedrock: true, url: "https://www.vice.com/en/rss" },
      { name: "BBC News", url: gnGB('(transgender OR "trans rights" OR "Cass Review") site:bbc.co.uk when:3d') },
      { name: "The Guardian", url: gnGB('(transgender OR "trans rights") site:theguardian.com when:3d') },
      { name: "The Independent", url: gnGB('(transgender OR "trans rights") site:independent.co.uk when:3d') },
      { name: "Sky News", url: gnGB('(transgender OR "trans rights" OR "single-sex" OR "biological male" OR "biological female" OR "gender ideology" OR "adult human female" OR "gender-critical" OR "Cass Review") site:news.sky.com when:30d') },
      { name: "Channel 4 News", url: gnGB('(transgender OR "trans rights" OR "single-sex" OR "biological male" OR "biological female" OR "gender ideology" OR "adult human female" OR "gender-critical" OR "Cass Review") site:channel4.com when:30d') },
      { name: "The Times", url: gnGB('(transgender OR "trans rights" OR "Cass Review" OR "single-sex" OR "biological male" OR "biological female" OR "gender ideology" OR "adult human female" OR "gender-critical" OR "Cass Review") site:thetimes.co.uk when:30d') },
      { name: "The Telegraph", url: gnGB('(transgender OR "trans rights") site:telegraph.co.uk when:30d') },
      { name: "The Sun", url: gnGB('(transgender OR "trans rights" OR "single-sex" OR "biological male" OR "biological female" OR "gender ideology" OR "adult human female" OR "gender-critical" OR "Cass Review") site:thesun.co.uk when:3d') },
      { name: "GB News", url: gnGB('(transgender OR "trans rights" OR "single-sex" OR "biological male" OR "biological female" OR "gender ideology" OR "adult human female" OR "gender-critical" OR "Cass Review") site:gbnews.com when:3d') },
      { name: "Daily Mirror", url: gnGB('(transgender OR "trans rights" OR "single-sex" OR "biological male" OR "biological female" OR "gender ideology" OR "adult human female" OR "gender-critical" OR "Cass Review") site:mirror.co.uk when:3d') },
      { name: "The Spectator", url: gnGB('(transgender OR "trans rights" OR "single-sex" OR "biological male" OR "biological female" OR "gender ideology" OR "adult human female" OR "gender-critical" OR "Cass Review") site:spectator.co.uk when:30d') },
      { name: "HuffPost UK", url: gnGB('(transgender OR "trans rights" OR "single-sex" OR "biological male" OR "biological female" OR "gender ideology" OR "adult human female" OR "gender-critical" OR "Cass Review") site:huffingtonpost.co.uk when:30d') },
      { name: "TalkTV", url: gnGB('(transgender OR "trans rights" OR "single-sex" OR "biological male" OR "biological female" OR "gender ideology" OR "adult human female" OR "gender-critical" OR "Cass Review") site:talk.tv when:30d') },
      { name: "ITV News", url: gnGB('(transgender OR "trans rights" OR "single-sex" OR "biological male" OR "biological female" OR "gender ideology" OR "adult human female" OR "gender-critical" OR "Cass Review") site:itv.com when:3d') },
      { name: "Metro", url: gnGB('(transgender OR "trans rights") site:metro.co.uk when:3d') }
    ],
    wins: [
      { name: "Trans Wins", url: gnGB('(transgender OR "trans rights") (wins OR victory OR "first trans" OR milestone OR landmark) when:7d') },
      { name: "Trans Legal Wins", url: gn('(transgender OR "trans rights") (court OR judge) (blocks OR overturns) when:7d') }
    ],
    mainstream: [
      { name: "Washington Post Trans", url: gn('site:washingtonpost.com ("transgender" OR "gender-affirming care ban") when:7d') },
      { name: "NYT Trans Coverage", url: gn('site:nytimes.com ("transgender" OR "gender-affirming care ban") when:7d') }
    ]
  }
};
var INTEL_SOURCES = [];

// news-digest/_classifier.ts
var CRITICAL_KEYWORDS = {
  "nuclear strike": "military",
  "nuclear attack": "military",
  "nuclear war": "military",
  "invasion": "conflict",
  "declaration of war": "conflict",
  "martial law": "military",
  "coup": "military",
  "coup attempt": "military",
  "genocide": "conflict",
  "ethnic cleansing": "conflict",
  "chemical attack": "terrorism",
  "biological attack": "terrorism",
  "dirty bomb": "terrorism",
  "mass casualty": "conflict",
  "pandemic declared": "health",
  "health emergency": "health",
  "nato article 5": "military",
  "evacuation order": "disaster",
  "meltdown": "disaster",
  "nuclear meltdown": "disaster"
};
var HIGH_KEYWORDS = {
  "war": "conflict",
  "armed conflict": "conflict",
  "airstrike": "conflict",
  "air strike": "conflict",
  "drone strike": "conflict",
  "missile": "military",
  "missile launch": "military",
  "troops deployed": "military",
  "military escalation": "military",
  "bombing": "conflict",
  "casualties": "conflict",
  "hostage": "terrorism",
  "terrorist": "terrorism",
  "terror attack": "terrorism",
  "assassination": "crime",
  "cyber attack": "cyber",
  "ransomware": "cyber",
  "data breach": "cyber",
  "sanctions": "economic",
  "embargo": "economic",
  "earthquake": "disaster",
  "tsunami": "disaster",
  "hurricane": "disaster",
  "typhoon": "disaster"
};
var MEDIUM_KEYWORDS = {
  "protest": "protest",
  "protests": "protest",
  "riot": "protest",
  "riots": "protest",
  "unrest": "protest",
  "demonstration": "protest",
  "strike action": "protest",
  "military exercise": "military",
  "naval exercise": "military",
  "arms deal": "military",
  "weapons sale": "military",
  "diplomatic crisis": "diplomatic",
  "ambassador recalled": "diplomatic",
  "expel diplomats": "diplomatic",
  "trade war": "economic",
  "tariff": "economic",
  "recession": "economic",
  "inflation": "economic",
  "market crash": "economic",
  "flood": "disaster",
  "flooding": "disaster",
  "wildfire": "disaster",
  "volcano": "disaster",
  "eruption": "disaster",
  "outbreak": "health",
  "epidemic": "health",
  "infection spread": "health",
  "oil spill": "environmental",
  "pipeline explosion": "infrastructure",
  "blackout": "infrastructure",
  "power outage": "infrastructure",
  "internet outage": "infrastructure",
  "derailment": "infrastructure"
};
var LOW_KEYWORDS = {
  "election": "diplomatic",
  "vote": "diplomatic",
  "referendum": "diplomatic",
  "summit": "diplomatic",
  "treaty": "diplomatic",
  "agreement": "diplomatic",
  "negotiation": "diplomatic",
  "talks": "diplomatic",
  "peacekeeping": "diplomatic",
  "humanitarian aid": "diplomatic",
  "ceasefire": "diplomatic",
  "peace treaty": "diplomatic",
  "climate change": "environmental",
  "emissions": "environmental",
  "pollution": "environmental",
  "deforestation": "environmental",
  "drought": "environmental",
  "vaccine": "health",
  "vaccination": "health",
  "disease": "health",
  "virus": "health",
  "public health": "health",
  "covid": "health",
  "interest rate": "economic",
  "gdp": "economic",
  "unemployment": "economic",
  "regulation": "economic"
};
var TECH_HIGH_KEYWORDS = {
  "major outage": "infrastructure",
  "service down": "infrastructure",
  "global outage": "infrastructure",
  "zero-day": "cyber",
  "critical vulnerability": "cyber",
  "supply chain attack": "cyber",
  "mass layoff": "economic"
};
var TECH_MEDIUM_KEYWORDS = {
  "outage": "infrastructure",
  "breach": "cyber",
  "hack": "cyber",
  "vulnerability": "cyber",
  "layoff": "economic",
  "layoffs": "economic",
  "antitrust": "economic",
  "monopoly": "economic",
  "ban": "economic",
  "shutdown": "infrastructure"
};
var TECH_LOW_KEYWORDS = {
  "ipo": "economic",
  "funding": "economic",
  "acquisition": "economic",
  "merger": "economic",
  "launch": "tech",
  "release": "tech",
  "update": "tech",
  "partnership": "economic",
  "startup": "tech",
  "ai model": "tech",
  "open source": "tech"
};
var EXCLUSIONS = [
  "protein",
  "couples",
  "relationship",
  "dating",
  "diet",
  "fitness",
  "recipe",
  "cooking",
  "shopping",
  "fashion",
  "celebrity",
  "movie",
  "tv show",
  "sports",
  "game",
  "concert",
  "festival",
  "wedding",
  "vacation",
  "travel tips",
  "life hack",
  "self-care",
  "wellness"
];
var SHORT_KEYWORDS = /* @__PURE__ */ new Set([
  "war",
  "coup",
  "ban",
  "vote",
  "riot",
  "riots",
  "hack",
  "talks",
  "ipo",
  "gdp",
  "virus",
  "disease",
  "flood"
]);
var keywordRegexCache = /* @__PURE__ */ new Map();
function getKeywordRegex(kw) {
  const safeKw = kw.slice(0, 100);
  let re = keywordRegexCache.get(safeKw);
  if (!re) {
    const escaped = safeKw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = SHORT_KEYWORDS.has(safeKw) ? new RegExp(`\\b${escaped}\\b`) : new RegExp(escaped);
    keywordRegexCache.set(safeKw, re);
  }
  return re;
}
function matchKeywords(titleLower, keywords) {
  for (const [kw, cat] of Object.entries(keywords)) {
    if (getKeywordRegex(kw).test(titleLower)) {
      return { keyword: kw, category: cat };
    }
  }
  return null;
}
function classifyByKeyword(title, variant) {
  const lower = title.toLowerCase();
  if (EXCLUSIONS.some((ex) => lower.includes(ex))) {
    return { level: "info", category: "general", confidence: 0.3, source: "keyword" };
  }
  const isTech = variant === "tech";
  let match = matchKeywords(lower, CRITICAL_KEYWORDS);
  if (match) return { level: "critical", category: match.category, confidence: 0.9, source: "keyword" };
  match = matchKeywords(lower, HIGH_KEYWORDS);
  if (match) return { level: "high", category: match.category, confidence: 0.8, source: "keyword" };
  if (isTech) {
    match = matchKeywords(lower, TECH_HIGH_KEYWORDS);
    if (match) return { level: "high", category: match.category, confidence: 0.75, source: "keyword" };
  }
  match = matchKeywords(lower, MEDIUM_KEYWORDS);
  if (match) return { level: "medium", category: match.category, confidence: 0.7, source: "keyword" };
  if (isTech) {
    match = matchKeywords(lower, TECH_MEDIUM_KEYWORDS);
    if (match) return { level: "medium", category: match.category, confidence: 0.65, source: "keyword" };
  }
  match = matchKeywords(lower, LOW_KEYWORDS);
  if (match) return { level: "low", category: match.category, confidence: 0.6, source: "keyword" };
  if (isTech) {
    match = matchKeywords(lower, TECH_LOW_KEYWORDS);
    if (match) return { level: "low", category: match.category, confidence: 0.55, source: "keyword" };
  }
  return { level: "info", category: "general", confidence: 0.3, source: "keyword" };
}

// news-digest/_source-tiers.ts
var TIER1 = /* @__PURE__ */ new Set(["Reuters", "AP News", "AFP", "Bloomberg", "BBC World", "BBC Middle East", "BBC News"]);
var TIER2 = /* @__PURE__ */ new Set(["The Guardian", "Guardian Trans", "Guardian World", "Financial Times", "The Times", "Washington Post Trans", "NYT Trans Coverage"]);
function getSourceTier(source) {
  if (TIER1.has(source)) return 1;
  if (TIER2.has(source)) return 2;
  return 3;
}

// news-digest/_cache-keys.ts
var STORY_TTL = 86400;
var DIGEST_ACCUMULATOR_TTL = 172800;
var STORY_TRACK_KEY = (hash) => `story:track:v1:${hash}`;
var STORY_SOURCES_KEY = (hash) => `story:sources:v1:${hash}`;
var STORY_PEAK_KEY = (hash) => `story:peak:v1:${hash}`;
var STORY_TRACK_KEY_PREFIX = "story:track:v1:";
var DIGEST_ACCUMULATOR_KEY = (variant, lang) => `digest:acc:v1:${variant}:${lang}`;

// news-digest/_trans-keywords.ts
var IDENTITY_TERMS = [
  // 'trans' bare keyword removed — \btrans\b matches 'trans-Atlantic', 'trans-Pennine' etc via hyphen word boundary
  "transgender",
  "trans rights",
  "gender identity",
  "gender expression",
  "trans woman",
  "trans women",
  "trans man",
  "trans men",
  "transmasculine",
  "transmasc",
  "transfeminine",
  "transfemme",
  "nonbinary",
  "genderqueer",
  "genderfluid",
  "agender",
  "bigender",
  "two-spirit",
  // Indigenous North American
  "transsexual",
  // older term, still used in legal documents
  "MTF",
  // community shorthand: male-to-female
  "FTM",
  // community shorthand: female-to-male
  "enby",
  // NB / nonbinary slang
  "travesti",
  // LatAm — specifically Argentine/Brazilian context
  "hijra",
  // South Asia — legally recognised third gender in India/Bangladesh
  "kathoey",
  // Thai
  "muxe",
  // Zapotec/Mexican
  "bakla",
  // Filipino
  "fa'afafine"
  // Samoa
];
var MEDICAL_TERMS = [
  "gender-affirming care",
  "gender dysphoria",
  "puberty blockers",
  "hormone therapy",
  "HRT",
  // ⚠️ overlaps with menopause HRT
  "cross-sex hormones",
  "feminizing hormones",
  "masculinizing hormones",
  "gender reassignment",
  "gender confirmation",
  "top surgery",
  "bottom surgery",
  "vaginoplasty",
  "phalloplasty",
  "metoidioplasty",
  "voice training",
  "voice therapy",
  "WPATH SOC",
  // WPATH Standards of Care
  "Standards of Care",
  "informed consent model",
  "trans healthcare"
];
var HOSTILE_FRAMING = [
  // Anti-trans rhetorical framing
  "gender ideology",
  "radical gender ideology",
  "trans ideology",
  "trans agenda",
  "gender extremism",
  "gender critical",
  "gender-critical",
  "trans debate",
  "TERF",
  // tracker term — surfaces both critique-of and use-of
  // "Single-sex spaces" framing — almost always trans-targeting in current discourse
  "single-sex spaces",
  "single sex spaces",
  "sex-segregated spaces",
  "women-only spaces",
  "women only spaces",
  "female-only spaces",
  // "Biological sex" framing — when used in policy/rights context, targets trans inclusion
  "biological sex",
  "biological male",
  "biological males",
  "biological female",
  "biological females",
  "biological woman",
  "biological women",
  "biological man",
  "biological men",
  "adult human female",
  // explicit anti-trans slogan
  "adult human male",
  // "Sex-based" framing
  "sex-based rights",
  "sex based rights",
  // Women's sport / changing rooms framing
  "protecting women and girls",
  "women and girls",
  // when paired with sport/spaces context
  "women's sport",
  "women's sports",
  "female athletes",
  "girls' sport",
  "girls' sports",
  "changing rooms",
  "female changing rooms",
  "women-only changing",
  // Prison / hospital / domestic violence shelter framing
  "male-bodied",
  "female-bodied",
  "female prison",
  "women's prison",
  "female ward",
  "women's ward",
  "female refuge",
  "women's refuge",
  // Youth / education framing — hostile outlets target trans youth via these terms
  "gender confused",
  "gender confusion",
  "social contagion",
  "rapid onset gender dysphoria",
  "ROGD",
  "transing kids",
  "transing children",
  "trans kids",
  // both supportive and hostile use this
  "gender questioning",
  "gender-questioning",
  // Detransition framing (already in DETRANS_TERMS but worth including in hostile context)
  "irreversible damage",
  "mutilation",
  // Toilet / bathroom framing
  "female toilets",
  "male toilets",
  "women's toilets",
  "men's toilets",
  "mixed-sex toilets"
];
var KEY_PEOPLE = [
  "Erin Reed",
  "Dylan Mulvaney",
  "Chase Strangio",
  "Munroe Bergdorf",
  "Laverne Cox",
  "Schuyler Bailar",
  "Sarah McBride",
  // US Congresswoman
  "Imara Jones",
  // TransLash founder
  "Jamie Reed",
  // detransitioner / whistleblower
  "Helen Joyce",
  // anti-trans commentator
  "Kathleen Stock"
  // anti-trans academic
];
var DETRANS_TERMS = [
  "detransition",
  "detransitioner",
  "desistance"
];

// news-digest/_trans-filter.ts
var TRANS_RELEVANT_KEYWORDS = [
  ...IDENTITY_TERMS,
  ...MEDICAL_TERMS,
  ...KEY_PEOPLE,
  ...DETRANS_TERMS,
  ...HOSTILE_FRAMING,
  // Additional terms not in keyword groups — catch false negatives from
  // broad LGBTQ+ outlets that use these without 'transgender' explicitly.
  "gender-affirming",
  "gender nonconforming",
  "gender diverse",
  "gender diversity",
  "gender minority",
  "gender minorities",
  "trans-inclusive",
  "trans inclusive",
  "transphobia",
  "transphobic",
  "anti-trans",
  "trans community",
  "trans people",
  "trans youth",
  "trans kids",
  "trans adults",
  "trans athlete",
  "trans athletes",
  "trans student",
  "trans students",
  "trans military",
  "trans visibility",
  "trans awareness",
  "trans pride",
  "trans health",
  "trans care",
  "trans lives",
  "trans rights",
  "gender clinic",
  "gender medicine",
  "gender treatment",
  "gender surgery",
  "gender transition",
  "gender expression",
  "SOGIESC",
  // UN terminology: sexual orientation, gender identity/expression, sex characteristics
  "gender marker",
  "name change",
  // legal name change — trans-specific in context
  "legal gender",
  "chosen name",
  "dead name",
  "deadname"
].map((kw) => kw.toLowerCase());
var TRANS_PATTERN = new RegExp(
  "\\b(?:" + TRANS_RELEVANT_KEYWORDS.map(
    (kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  ).join("|") + ")\\b",
  "i"
);
function isTransRelevant(item) {
  if (!item.title) return true;
  return TRANS_PATTERN.test(item.title);
}

// news-digest/_trans-ai-filter.ts
var import_client_bedrock_runtime = require("@aws-sdk/client-bedrock-runtime");
var SYSTEM_PROMPT = `You are a relevance classifier for a transgender news dashboard that tracks BOTH supportive and hostile coverage of trans people.

Given a JSON array of headlines, return a JSON array of booleans \u2014 true if the article relates to trans people, trans rights, gender identity policy, or trans healthcare.

CRITICAL: Anti-trans content often does NOT use the word "trans" or "transgender" explicitly. Mark TRUE for headlines using hostile framing or dog-whistle terms that target trans people, including:

- "single-sex spaces", "sex-segregated spaces", "women-only spaces"
- "biological male/female", "biological woman/man", "adult human female/male"
- "sex-based rights", "protecting women and girls" (in policy/sport/spaces context)
- "gender ideology", "gender-critical", "TERF"
- "women's sport", "female athletes" (when in fairness/inclusion debate context)
- "women's prison", "female ward", "women's refuge" (in policy debate context)
- "changing rooms", "toilets" (when discussing access/policy)
- "gender questioning", "trans kids", "social contagion"
- Coverage of figures like JK Rowling, Helen Joyce, Kathleen Stock, Maya Forstater on gender issues
- EHRC guidance, Equality Act updates, Cass Review coverage
- Court cases involving gender recognition, trans healthcare, or sex-based rights
- "Conversion therapy" debates that involve gender identity

Mark FALSE only for:
- Stories where a trans person is incidentally mentioned but the story is about something else entirely (e.g. a trans person caught up in an unrelated traffic accident)
- Pure women's rights stories with no trans-related framing or implications
- Unrelated topics that happen to use words like "gender" in non-trans contexts (e.g. gender pay gap statistics with no trans angle)

When in doubt, mark TRUE. False positives are recoverable; missing hostile coverage of trans people is the bigger failure.

Respond ONLY with a JSON array of booleans, no other text.`;
async function aiFilterTransRelevant(items) {
  if (items.length === 0) return [];
  const modelId = process.env.AWS_BEDROCK_MODEL_ID ?? "eu.anthropic.claude-haiku-4-5-20251001-v1:0";
  const region = process.env.AWS_BEDROCK_REGION ?? "eu-west-1";
  try {
    const bedrock = new import_client_bedrock_runtime.BedrockRuntimeClient({ region });
    const titles = items.map((i) => i.title ?? "");
    const result = await Promise.race([
      bedrock.send(new import_client_bedrock_runtime.InvokeModelCommand({
        modelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 256,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: JSON.stringify(titles) }]
        })
      })),
      new Promise((_, reject) => setTimeout(() => reject(new Error("bedrock_timeout")), 8e3))
    ]);
    const raw = JSON.parse(new TextDecoder().decode(result.body));
    const text = (raw.content?.[0]?.text ?? "").trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map(Boolean);
  } catch (err) {
    console.warn("[ai-filter] bedrock failed, dropping keyword-failed items:", err.message);
  }
  return items.map(() => false);
}

// _shared/media-bias-domains.ts
var SOURCE_REGISTRY = {
  "aberdareonline.co.uk": { name: "Aberdare Online", domain: "aberdareonline.co.uk", editorialBias: "neutral", aliases: ["aberdareonline.co.uk"] },
  "advocate.com": { name: "The Advocate", domain: "advocate.com", editorialBias: "positive", aliases: ["Advocate.com", "Puberty Blocker Rulings"] },
  "akc.org": { name: "American Kennel Club", domain: "akc.org", editorialBias: "neutral", aliases: ["American Kennel Club"] },
  "andrewsullivan.substack.com": { name: "Andrew Sullivan", domain: "andrewsullivan.substack.com", editorialBias: "hostile", aliases: ["The Weekly Dish | Andrew Sullivan"] },
  "aol.com": { name: "AOL", domain: "aol.com", editorialBias: "neutral", aliases: ["AOL.com"] },
  "apnews.com": { name: "Apnews", domain: "apnews.com", editorialBias: "neutral", aliases: [] },
  "assignedmedia.org": { name: "Assigned Media", domain: "assignedmedia.org", editorialBias: "supportive", aliases: ["Assigned Media Backfill", "Assigned Media Search"] },
  "attitude.co.uk": { name: "Attitude", domain: "attitude.co.uk", editorialBias: "supportive", aliases: ["Attitude Backfill", "Attitude Search"] },
  "bbc.co.uk": { name: "BBC News", domain: "bbc.co.uk", editorialBias: "negative", aliases: ["BBC", "BBC Trans Coverage"] },
  "bostonglobe.com": { name: "The Boston Globe", domain: "bostonglobe.com", editorialBias: "neutral", aliases: ["The Boston Globe"] },
  "catholicworldreport.com": { name: "Catholic World Report", domain: "catholicworldreport.com", editorialBias: "neutral", aliases: ["Catholic World Report"] },
  "cbn.com": { name: "CBN", domain: "cbn.com", editorialBias: "neutral", aliases: ["CBN", "cbn.com"] },
  "channel4.com": { name: "Channel 4 News", domain: "channel4.com", editorialBias: "positive", aliases: ["Channel 4", "Channel 4 News Backfill", "Channel 4 News Search"] },
  "dailymail.co.uk": { name: "The Daily Mail", domain: "dailymail.co.uk", editorialBias: "hostile", aliases: ["Daily Mail", "Daily Mail Backfill", "Daily Mail Search", "Mail Trans"] },
  "divamag.co.uk": { name: "DIVA Magazine", domain: "divamag.co.uk", editorialBias: "supportive", aliases: ["DIVA Magazine Backfill", "DIVA Magazine Search"] },
  "donoharmmedicine.org": { name: "Do No Harm", domain: "donoharmmedicine.org", editorialBias: "neutral", aliases: ["donoharmmedicine.org"] },
  "erininthemorning.com": { name: "Erin in the Morning", domain: "erininthemorning.com", editorialBias: "supportive", aliases: ["Erin Backfill", "Erin Search"] },
  "express.co.uk": { name: "Daily Express", domain: "express.co.uk", editorialBias: "negative", aliases: ["Daily Express Backfill", "Daily Express Search", "Express"] },
  "gate.ngo": { name: "GATE Global", domain: "gate.ngo", editorialBias: "supportive", aliases: ["GATE Backfill", "GATE Search"] },
  "gbnews.com": { name: "GB News", domain: "gbnews.com", editorialBias: "hostile", aliases: [] },
  "genderanalysis.net": { name: "Genderanalysis", domain: "genderanalysis.net", editorialBias: "neutral", aliases: ["Gender Analysis"] },
  "glaad.org": { name: "GLAAD", domain: "glaad.org", editorialBias: "supportive", aliases: ["GLAAD Backfill", "GLAAD Search"] },
  "glad.org": { name: "GLAD Law", domain: "glad.org", editorialBias: "supportive", aliases: ["GLAD Law"] },
  "goodlawproject.org": { name: "Good Law Project", domain: "goodlawproject.org", editorialBias: "positive", aliases: [] },
  "huffingtonpost.co.uk": { name: "HuffPost UK", domain: "huffingtonpost.co.uk", editorialBias: "positive", aliases: ["HuffPost", "HuffPost UK Backfill", "HuffPost UK Search"] },
  "idahonews.com": { name: "KBOI", domain: "idahonews.com", editorialBias: "neutral", aliases: ["KBOI"] },
  "idahonews6.com": { name: "Idaho News 6", domain: "idahonews6.com", editorialBias: "neutral", aliases: ["Idaho News 6"] },
  "ilga.org": { name: "ILGA World", domain: "ilga.org", editorialBias: "supportive", aliases: [] },
  "independent.co.uk": { name: "The Independent", domain: "independent.co.uk", editorialBias: "neutral", aliases: ["Independent Trans"] },
  "inews.co.uk": { name: "The i", domain: "inews.co.uk", editorialBias: "neutral", aliases: ["The i Backfill", "The i Search", "i news", "inews"] },
  "itv.com": { name: "ITV News", domain: "itv.com", editorialBias: "negative", aliases: ["ITV"] },
  "lambdalegal.org": { name: "Lambda Legal", domain: "lambdalegal.org", editorialBias: "supportive", aliases: [] },
  "mainichi.jp": { name: "Mainichi", domain: "mainichi.jp", editorialBias: "neutral", aliases: ["\u6BCE\u65E5\u65B0\u805E"] },
  "metro.co.uk": { name: "Metro", domain: "metro.co.uk", editorialBias: "neutral", aliases: ["Metro Trans", "Metro.co.uk"] },
  "mirror.co.uk": { name: "The Mirror", domain: "mirror.co.uk", editorialBias: "neutral", aliases: ["Daily Mirror"] },
  "nationalreview.com": { name: "National Review", domain: "nationalreview.com", editorialBias: "neutral", aliases: ["National Review"] },
  "ndtv.com": { name: "NDTV", domain: "ndtv.com", editorialBias: "neutral", aliases: ["Asia-Pacific Trans News"] },
  "nytimes.com": { name: "New York Times", domain: "nytimes.com", editorialBias: "neutral", aliases: ["The New York Times"] },
  "operationsports.com": { name: "Operation Sports", domain: "operationsports.com", editorialBias: "neutral", aliases: ["Operation Sports"] },
  "pinknews.co.uk": { name: "Pink News", domain: "pinknews.co.uk", editorialBias: "supportive", aliases: ["PinkNews", "PinkNews | Latest lesbian, gay, bi and trans news"] },
  "reuters.com": { name: "Reuters", domain: "reuters.com", editorialBias: "neutral", aliases: ["Reuters Trans Coverage"] },
  "sky.com": { name: "Sky News", domain: "sky.com", editorialBias: "neutral", aliases: [] },
  "sltrib.com": { name: "The Salt Lake Tribune", domain: "sltrib.com", editorialBias: "neutral", aliases: ["The Salt Lake Tribune"] },
  "spectator.co.uk": { name: "The Spectator", domain: "spectator.co.uk", editorialBias: "hostile", aliases: ["The Spectator Backfill", "The Spectator Search"] },
  "spokesman.com": { name: "The Spokesman-Review", domain: "spokesman.com", editorialBias: "neutral", aliases: ["The Spokesman-Review"] },
  "statnews.com": { name: "STAT News", domain: "statnews.com", editorialBias: "neutral", aliases: ["STAT", "STAT News", "STAT News LGBTQ"] },
  "stonewall.org.uk": { name: "Stonewall", domain: "stonewall.org.uk", editorialBias: "supportive", aliases: ["Stonewall Backfill", "Stonewall Search"] },
  "talk.tv": { name: "TalkTV", domain: "talk.tv", editorialBias: "hostile", aliases: ["Talk TV", "TalkTV Backfill", "TalkTV Search"] },
  "telegraph.co.uk": { name: "The Daily Telegraph", domain: "telegraph.co.uk", editorialBias: "hostile", aliases: ["The Telegraph", "The Telegraph Trans"] },
  "tgeu.org": { name: "TGEU", domain: "tgeu.org", editorialBias: "supportive", aliases: ["TGEU News"] },
  "thegrio.com": { name: "TheGrio", domain: "thegrio.com", editorialBias: "neutral", aliases: ["TheGrio"] },
  "theguardian.com": { name: "The Guardian", domain: "theguardian.com", editorialBias: "negative", aliases: ["Guardian Trans", "Guardian Transgender"] },
  "them.us": { name: "Them", domain: "them.us", editorialBias: "supportive", aliases: [] },
  "theolympian.com": { name: "The Olympian", domain: "theolympian.com", editorialBias: "neutral", aliases: ["The Olympian"] },
  "thesun.co.uk": { name: "The Sun", domain: "thesun.co.uk", editorialBias: "hostile", aliases: ["The Sun Backfill", "The Sun Search"] },
  "thetimes.co.uk": { name: "The Times", domain: "thetimes.co.uk", editorialBias: "hostile", aliases: ["The Times Trans", "Times Trans"] },
  "theweek.com": { name: "The Week", domain: "theweek.com", editorialBias: "neutral", aliases: ["The Week"] },
  "transactual.org.uk": { name: "TransActual", domain: "transactual.org.uk", editorialBias: "supportive", aliases: ["TransActual Backfill", "TransActual Search", "TransActual UK"] },
  "transequality.org": { name: "Trans Equality", domain: "transequality.org", editorialBias: "supportive", aliases: ["Trans Equality Backfill", "Trans Equality Search"] },
  "transgenderfeed.com": { name: "Transgender Feed", domain: "transgenderfeed.com", editorialBias: "supportive", aliases: [] },
  "transgenderlawcenter.org": { name: "Trans Law Center", domain: "transgenderlawcenter.org", editorialBias: "supportive", aliases: ["Trans Law Center Backfill", "Trans Law Center Search"] },
  "translash.org": { name: "TransLash", domain: "translash.org", editorialBias: "supportive", aliases: ["TransLash Backfill", "TransLash Search"] },
  "transvitae.com": { name: "TransVitae", domain: "transvitae.com", editorialBias: "supportive", aliases: [] },
  "ucla.edu": { name: "UCLA", domain: "ucla.edu", editorialBias: "neutral", aliases: ["Newsroom | UCLA", "UCLA"] },
  "vice.com": { name: "Vice UK", domain: "vice.com", editorialBias: "positive", aliases: ["Vice", "Vice UK Backfill", "Vice UK Search"] },
  "washingtonpost.com": { name: "Washington Post", domain: "washingtonpost.com", editorialBias: "neutral", aliases: ["The Washington Post"] },
  "washingtonstand.com": { name: "The Washington Stand", domain: "washingtonstand.com", editorialBias: "neutral", aliases: ["The Washington Stand"] }
};
var REGISTRY_DOMAINS = new Set(Object.keys(SOURCE_REGISTRY));
var EDITORIAL_BY_DOMAIN = Object.fromEntries(
  Object.values(SOURCE_REGISTRY).map((s) => [s.domain, s.editorialBias])
);
var NAME_BY_DOMAIN = Object.fromEntries(
  Object.values(SOURCE_REGISTRY).map((s) => [s.domain, s.name])
);
var ALIAS_TO_DOMAIN = (() => {
  const m = {};
  for (const entry of Object.values(SOURCE_REGISTRY)) {
    m[entry.name] = entry.domain;
    for (const a of entry.aliases) m[a] = entry.domain;
  }
  return m;
})();
function normaliseBiasHost(hostname) {
  const h = hostname.toLowerCase().replace(/^www\./, "").replace(/^amp\./, "").replace(/^m\./, "");
  if (h === "diva-magazine.com") return "divamag.co.uk";
  return h;
}
function isGoogleNewsUrl(url) {
  try {
    const h = normaliseBiasHost(new URL(url).hostname);
    return h === "news.google.com" || h.endsWith(".google.com");
  } catch {
    return false;
  }
}
function extractBiasDomainFromUrl(url) {
  try {
    const h = normaliseBiasHost(new URL(url).hostname);
    if (h === "news.google.com" || h.endsWith(".google.com")) {
      return null;
    }
    for (const k of REGISTRY_DOMAINS) {
      if (h === k || h.endsWith("." + k)) return k;
    }
    return null;
  } catch {
    return null;
  }
}
function extractPublisherSuffix(title) {
  const m = title.match(/\s+-\s+(.{2,100})\s*$/);
  return m?.[1]?.trim() ?? null;
}
function extractBiasDomain(url, sourceName, title) {
  const urlDomain = extractBiasDomainFromUrl(url);
  if (urlDomain) return urlDomain;
  if (title && isGoogleNewsUrl(url)) {
    const publisher = extractPublisherSuffix(title);
    if (publisher && ALIAS_TO_DOMAIN[publisher]) {
      return ALIAS_TO_DOMAIN[publisher];
    }
    if (sourceName && ALIAS_TO_DOMAIN[sourceName]) {
      return ALIAS_TO_DOMAIN[sourceName];
    }
    return null;
  }
  if (sourceName && ALIAS_TO_DOMAIN[sourceName]) {
    return ALIAS_TO_DOMAIN[sourceName];
  }
  return null;
}
function canResolveBiasDomain(item) {
  const urlDomain = extractBiasDomainFromUrl(item.link);
  if (urlDomain) return true;
  if (isGoogleNewsUrl(item.link)) {
    const publisher = extractPublisherSuffix(item.title);
    if (publisher && ALIAS_TO_DOMAIN[publisher]) return true;
    return !!ALIAS_TO_DOMAIN[item.source];
  }
  return !!ALIAS_TO_DOMAIN[item.source];
}

// _shared/media-bias-queue.ts
var BIAS_QUEUE_KEY = "media:bias:queue";
var BIAS_QUEUE_MAX = 500;
var BIAS_DEDUP_TTL_SECONDS = 60 * 60 * 24 * 7;

// news-digest/index.ts
var CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var RSS_ACCEPT = "application/rss+xml, application/xml, text/xml, */*";
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
var markNoCacheResponse = (_req) => {
};
var getRelayBaseUrl = () => null;
var getRelayHeaders = (h) => h;
var VALID_VARIANTS = /* @__PURE__ */ new Set(["full", "tech", "finance", "happy", "commodity", "trans"]);
var fallbackDigestCache = /* @__PURE__ */ new Map();
var ITEMS_PER_FEED = 10;
var MAX_ITEMS_PER_CATEGORY = 30;
var FEED_TIMEOUT_MS = 8e3;
var OVERALL_DEADLINE_MS = 25e3;
var BATCH_CONCURRENCY = 20;
var LEVEL_TO_PROTO = {
  critical: "THREAT_LEVEL_CRITICAL",
  high: "THREAT_LEVEL_HIGH",
  medium: "THREAT_LEVEL_MEDIUM",
  low: "THREAT_LEVEL_LOW",
  info: "THREAT_LEVEL_UNSPECIFIED"
};
var SEVERITY_SCORES = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25,
  info: 0
};
var SCORE_WEIGHTS = {
  severity: 0.55,
  sourceTier: 0.2,
  corroboration: 0.15,
  recency: 0.1
};
function extractStoryKey(title) {
  const STOP = /* @__PURE__ */ new Set(["a", "an", "the", "in", "on", "at", "to", "for", "of", "and", "or", "but", "is", "are", "was", "were", "has", "have", "had", "its", "with", "as", "by", "from", "that", "this", "it", "be", "will", "can", "not", "no", "up", "out", "over", "who", "what", "how", "when", "why", "says", "said", "after", "before", "amid", "also", "just", "now", "new", "two", "one", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]);
  const lower = title.toLowerCase().replace(/\s+[-\u2013\u2014]\s+[\w\s.]+$/, "").replace(/^(breaking|update|exclusive|watch|read|opinion|analysis):\s*/i, "").replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
  const words = new Set(
    lower.split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w))
  );
  return [...words].sort().slice(0, 8).join(" ");
}
var LIVE_FEED_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1e3;
var FUTURE_SKEW_MS = 6 * 60 * 60 * 1e3;
function isBackfillSource(source) {
  return /\bbackfill\b/i.test(source);
}
function normaliseDedupeText(value) {
  return value.toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').replace(/\s+[-–—]\s+[^-–—|]+$/g, "").replace(/\([^)]*(exclusive|video|watch)[^)]*\)/gi, "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
function liveItemDedupeKey(item) {
  const link = String(item.link ?? "").trim().toLowerCase();
  if (link.includes("news.google.com/rss/articles/")) {
    return `title:${normaliseDedupeText(item.title)}`;
  }
  return link ? `link:${link}` : `title:${normaliseDedupeText(item.title)}`;
}
function cleanLiveDigestItems(items) {
  const now = Date.now();
  const seen = /* @__PURE__ */ new Set();
  return items.filter((item) => {
    if (isBackfillSource(item.source)) return false;
    const publishedAt = Number(item.publishedAt);
    if (!Number.isFinite(publishedAt) || publishedAt <= 0) return false;
    if (publishedAt > now + FUTURE_SKEW_MS) return false;
    return publishedAt >= now - LIVE_FEED_MAX_AGE_MS;
  }).filter((item) => {
    const key = liveItemDedupeKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
var HERO_CATEGORY_PRIORITY = {
  healthcare: 12,
  legal: 11,
  "uk-press": 10,
  mainstream: 9,
  international: 8,
  safety: 3,
  community: 2,
  wins: 1
};
function heroScore(item, category) {
  const base = Number(item.importanceScore ?? 0);
  const priority = HERO_CATEGORY_PRIORITY[category] ?? 0;
  if (category === "safety" && base < 35) return base - 20;
  return base + priority;
}
function computeImportanceScore(level, source, corroborationCount, publishedAt) {
  const tier = getSourceTier(source);
  const tierScore = tier === 1 ? 100 : tier === 2 ? 75 : tier === 3 ? 50 : 25;
  const corroborationScore = Math.min(corroborationCount, 5) * 20;
  const ageMs = Date.now() - publishedAt;
  const recencyScore = Math.max(0, 1 - ageMs / (24 * 60 * 60 * 1e3)) * 100;
  return Math.round(
    SEVERITY_SCORES[level] * SCORE_WEIGHTS.severity + tierScore * SCORE_WEIGHTS.sourceTier + corroborationScore * SCORE_WEIGHTS.corroboration + recencyScore * SCORE_WEIGHTS.recency
  );
}
function createTimeoutLinkedController(parentSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  parentSignal.addEventListener("abort", onAbort, { once: true });
  return {
    controller,
    cleanup: () => {
      clearTimeout(timeout);
      parentSignal.removeEventListener("abort", onAbort);
    }
  };
}
async function fetchRssText(url, signal) {
  const { controller, cleanup } = createTimeoutLinkedController(signal);
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": CHROME_UA,
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
        "Accept-Language": "en-US,en;q=0.9"
      },
      signal: controller.signal
    });
    if (!resp.ok) return null;
    return await resp.text();
  } finally {
    cleanup();
  }
}
async function fetchAndParseRss(feed, variant, signal) {
  const cacheKey = `rss:feed:v1:${variant}:${feed.url}`;
  try {
    const cached = await cachedFetchJson(cacheKey, 3600, async () => {
      let text = await fetchRssText(feed.url, signal).catch(() => null);
      if (!text) {
        const relayBase = getRelayBaseUrl();
        if (relayBase) {
          const relayUrl = `${relayBase}/rss?url=${encodeURIComponent(feed.url)}`;
          const { controller, cleanup } = createTimeoutLinkedController(signal);
          try {
            const resp = await fetch(relayUrl, {
              headers: getRelayHeaders({ Accept: RSS_ACCEPT }),
              signal: controller.signal
            });
            if (resp.ok) text = await resp.text();
          } catch {
          } finally {
            cleanup();
          }
        }
      }
      if (!text) return null;
      return parseRssXml(text, feed, variant);
    });
    return cached ?? [];
  } catch {
    return [];
  }
}
function parseRssXml(xml, feed, variant) {
  const items = [];
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  const entryRegex = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
  let matches = [...xml.matchAll(itemRegex)];
  const isAtom = matches.length === 0;
  if (isAtom) matches = [...xml.matchAll(entryRegex)];
  for (const match of matches.slice(0, ITEMS_PER_FEED)) {
    const block = match[1];
    const title = extractTag(block, "title");
    if (!title) continue;
    const summary = (extractTag(block, "description") || extractTag(block, "summary") || extractTag(block, "content:encoded") || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1e3);
    let link;
    if (isAtom) {
      const hrefMatch = block.match(/<link[^>]+href=["']([^"']+)["']/);
      link = hrefMatch?.[1] ?? "";
    } else {
      link = extractTag(block, "link");
    }
    if (!/^https?:\/\//i.test(link)) link = "";
    const pubDateStr = isAtom ? extractTag(block, "published") || extractTag(block, "updated") : extractTag(block, "pubDate");
    const parsedDate = pubDateStr ? new Date(pubDateStr) : /* @__PURE__ */ new Date();
    const publishedAt = Number.isNaN(parsedDate.getTime()) ? Date.now() : parsedDate.getTime();
    const threat = classifyByKeyword(title, variant);
    const isAlert = threat.level === "critical" || threat.level === "high";
    items.push({
      source: inferDigestDisplaySource(feed.name, link, title),
      title: isGoogleNewsUrlForDisplay(link) ? cleanGoogleNewsTitleForDisplay(title) : title,
      summary,
      link,
      publishedAt,
      isAlert,
      level: threat.level,
      category: threat.category,
      confidence: threat.confidence,
      classSource: "keyword",
      scanAllWithBedrock: feed.scanAllWithBedrock === true,
      importanceScore: 0,
      corroborationCount: 1,
      lang: feed.lang ?? "en"
    });
  }
  return items.length > 0 ? items : null;
}
var TAG_REGEX_CACHE = /* @__PURE__ */ new Map();
var KNOWN_TAGS = ["title", "link", "pubDate", "published", "updated", "description", "summary", "content:encoded"];
for (const tag of KNOWN_TAGS) {
  TAG_REGEX_CACHE.set(tag, {
    // Safer regexes with specific character classes to avoid catastrophic backtracking.
    cdata: new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, "i"),
    plain: new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, "i")
  });
}
function extractTag(xml, tag) {
  const cached = TAG_REGEX_CACHE.get(tag);
  const cdataRe = cached?.cdata ?? new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, "i");
  const plainRe = cached?.plain ?? new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, "i");
  if (xml.length > 5e4) return "";
  const cdataMatch = xml.match(cdataRe);
  if (cdataMatch) return cdataMatch[1].trim();
  const match = xml.match(plainRe);
  return match ? decodeXmlEntities(match[1].trim()) : "";
}
function decodeXmlEntities(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
async function enrichWithAiCache(items) {
  const candidates = items.filter((i) => i.classSource === "keyword");
  if (candidates.length === 0) return;
  const keyMap = /* @__PURE__ */ new Map();
  for (const item of candidates) {
    const hash = (await sha256Hex(item.title.toLowerCase())).slice(0, 16);
    const key = `classify:sebuf:v1:${hash}`;
    const existing = keyMap.get(key) ?? [];
    existing.push(item);
    keyMap.set(key, existing);
  }
  const keys = [...keyMap.keys()];
  const cached = await getCachedJsonBatch(keys);
  for (const [key, relatedItems] of keyMap) {
    const hit = cached.get(key);
    if (!hit || hit.level === "_skip" || !hit.level || !hit.category) continue;
    for (const item of relatedItems) {
      if (0.9 <= item.confidence) continue;
      item.level = hit.level;
      item.category = hit.category;
      item.confidence = 0.9;
      item.classSource = "llm";
      item.isAlert = hit.level === "critical" || hit.level === "high";
    }
  }
}
function normalizeTitle(title) {
  return title.toLowerCase().replace(/\s+[-\u2013\u2014]\s+[\w.-]+\.(?:com|org|net|co\.uk)\s*$/, "").replace(/\s+[-\u2013\u2014]\s+(?:reuters|ap news|bbc|cnn|al jazeera|france 24|dw news|pbs newshour|cbs news|nbc|abc|associated press|the guardian|nos nieuws|tagesschau|cnbc|the national)\s*$/, "").replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim().slice(0, 120);
}
function derivePhase(track) {
  const ageMs = Date.now() - track.firstSeen;
  if (track.mentionCount <= 1) return "STORY_PHASE_BREAKING";
  if (track.mentionCount <= 5 && ageMs < 2 * 60 * 60 * 1e3) return "STORY_PHASE_DEVELOPING";
  if (track.currentScore > 0 && track.peakScore > 0 && track.currentScore < track.peakScore * 0.5) return "STORY_PHASE_FADING";
  return "STORY_PHASE_SUSTAINED";
}
async function readStoryTracks(titleHashes) {
  if (titleHashes.length === 0) return /* @__PURE__ */ new Map();
  const fields = ["firstSeen", "lastSeen", "mentionCount", "sourceCount", "currentScore", "peakScore"];
  const commands = titleHashes.map((h) => [
    "HMGET",
    `${STORY_TRACK_KEY_PREFIX}${h}`,
    ...fields
  ]);
  const results = await runRedisPipeline(commands, true);
  const map = /* @__PURE__ */ new Map();
  for (let i = 0; i < titleHashes.length; i++) {
    const vals = results[i]?.result;
    if (!vals || !vals[0]) continue;
    map.set(titleHashes[i], {
      firstSeen: Number(vals[0]),
      lastSeen: Number(vals[1] ?? 0),
      mentionCount: Number(vals[2] ?? 0),
      sourceCount: Number(vals[3] ?? 0),
      currentScore: Number(vals[4] ?? 0),
      peakScore: Number(vals[5] ?? 0)
    });
  }
  return map;
}
function toProtoItem(item, storyMeta) {
  return {
    source: inferDigestDisplaySource(item.source, item.link, item.title),
    title: isGoogleNewsUrlForDisplay(item.link) ? cleanGoogleNewsTitleForDisplay(item.title) : item.title,
    link: item.link,
    publishedAt: item.publishedAt,
    isAlert: item.isAlert,
    importanceScore: item.importanceScore,
    corroborationCount: item.corroborationCount ?? 0,
    storyMeta,
    threat: {
      level: LEVEL_TO_PROTO[item.level],
      category: item.category,
      confidence: item.confidence,
      source: item.classSource
    },
    locationName: ""
  };
}
async function listFeedDigest(ctx, req) {
  const variant = VALID_VARIANTS.has(req.variant) ? req.variant : "full";
  const lang = req.lang || "en";
  const refresh = req.refresh === true;
  const digestCacheKey = `news:digest:v1:${variant}:${lang}`;
  const fallbackKey = `${variant}:${lang}`;
  const empty = () => ({ categories: {}, feedStatuses: {}, generatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  try {
    const buildFreshDigest = async () => {
      const result = await buildDigest(variant, lang);
      const totalItems = Object.values(result.categories).reduce((sum, b) => sum + b.items.length, 0);
      return totalItems > 0 ? result : null;
    };
    const fresh = refresh ? await buildFreshDigest() : await cachedFetchJson(
      digestCacheKey,
      900,
      buildFreshDigest
    );
    if (fresh === null) {
      markNoCacheResponse(ctx.request);
      return fallbackDigestCache.get(fallbackKey)?.data ?? empty();
    }
    if (fallbackDigestCache.size > 50) fallbackDigestCache.clear();
    fallbackDigestCache.set(fallbackKey, { data: fresh, ts: Date.now() });
    return fresh;
  } catch {
    markNoCacheResponse(ctx.request);
    return fallbackDigestCache.get(fallbackKey)?.data ?? empty();
  }
}
var STORY_BATCH_SIZE = 80;
async function writeStoryTracking(items, variant, lang, hashes) {
  if (items.length === 0) return;
  const now = Date.now();
  const accKey = DIGEST_ACCUMULATOR_KEY(variant, lang);
  for (let batchStart = 0; batchStart < items.length; batchStart += STORY_BATCH_SIZE) {
    const batch = items.slice(batchStart, batchStart + STORY_BATCH_SIZE);
    const commands = [];
    for (let i = 0; i < batch.length; i++) {
      const item = batch[i];
      const hash = hashes[batchStart + i];
      const trackKey = STORY_TRACK_KEY(hash);
      const sourcesKey = STORY_SOURCES_KEY(hash);
      const peakKey = STORY_PEAK_KEY(hash);
      const score = item.importanceScore;
      const nowStr = String(now);
      const ttl = STORY_TTL;
      commands.push(
        ["HINCRBY", trackKey, "mentionCount", "1"],
        [
          "HSET",
          trackKey,
          "lastSeen",
          nowStr,
          "currentScore",
          score,
          "title",
          item.title,
          "link",
          item.link,
          "severity",
          item.level,
          "lang",
          item.lang
        ],
        ["HSETNX", trackKey, "firstSeen", nowStr],
        ["ZADD", peakKey, "GT", score, "peak"],
        ["SADD", sourcesKey, item.source],
        ["EXPIRE", trackKey, ttl],
        ["EXPIRE", sourcesKey, ttl],
        ["EXPIRE", peakKey, ttl],
        ["ZADD", accKey, nowStr, hash]
      );
    }
    await runRedisPipeline(commands);
  }
  const cutoff = String(Date.now() - DIGEST_ACCUMULATOR_TTL * 1e3);
  await runRedisPipeline([
    ["ZREMRANGEBYSCORE", accKey, "-inf", cutoff],
    ["EXPIRE", accKey, DIGEST_ACCUMULATOR_TTL]
  ]);
}
async function buildDigest(variant, lang) {
  const feedsByCategory = VARIANT_FEEDS[variant] ?? {};
  const feedStatuses = {};
  const categories = {};
  const deadlineController = new AbortController();
  const deadlineTimeout = setTimeout(() => deadlineController.abort(), OVERALL_DEADLINE_MS);
  try {
    const allEntries = [];
    for (const [category, feeds] of Object.entries(feedsByCategory)) {
      const filtered = feeds.filter((f) => !f.lang || f.lang === lang);
      for (const feed of filtered) {
        allEntries.push({ category, feed });
      }
    }
    if (variant === "full") {
      const filteredIntel = INTEL_SOURCES.filter((f) => !f.lang || f.lang === lang);
      for (const feed of filteredIntel) {
        allEntries.push({ category: "intel", feed });
      }
    }
    const results = /* @__PURE__ */ new Map();
    const completedFeeds = /* @__PURE__ */ new Set();
    for (let i = 0; i < allEntries.length; i += BATCH_CONCURRENCY) {
      if (deadlineController.signal.aborted) break;
      const batch = allEntries.slice(i, i + BATCH_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async ({ category, feed }) => {
          const items = await fetchAndParseRss(feed, variant, deadlineController.signal);
          completedFeeds.add(feed.name);
          if (items.length === 0) feedStatuses[feed.name] = "empty";
          return { category, items };
        })
      );
      for (const result of settled) {
        if (result.status === "fulfilled") {
          const { category, items } = result.value;
          const existing = results.get(category) ?? [];
          existing.push(...items);
          results.set(category, existing);
        }
      }
    }
    for (const entry of allEntries) {
      if (!completedFeeds.has(entry.feed.name)) {
        feedStatuses[entry.feed.name] = "timeout";
      }
    }
    let allItems = [...results.values()].flat();
    if (variant === "trans") {
      const scanAllCandidates = allItems.filter(
        (item) => item.scanAllWithBedrock === true && !isTransRelevant(item)
      );
      if (scanAllCandidates.length > 0) {
        const maxScanAll = Number(process.env.TRANS_RELEVANCE_SCAN_MAX ?? "80");
        const limited = scanAllCandidates.slice(0, maxScanAll);
        console.log(
          `[digest] scan-all Bedrock relevance candidates=${scanAllCandidates.length} limited=${limited.length}`
        );
        const aiResults = await aiFilterTransRelevant(limited).catch((err) => {
          console.warn("[digest] scan-all Bedrock relevance filter failed:", err.message);
          return limited.map(() => false);
        });
        const aiKeep = new Set(limited.filter((_, i) => aiResults[i]));
        console.log(
          `[digest] scan-all Bedrock relevance passed=${aiKeep.size} rejected=${limited.length - aiKeep.size}`
        );
        for (const item of aiKeep) {
          item.classSource = "llm";
          item.confidence = Math.max(item.confidence, 0.9);
          if (item.level === "info" || item.level === "low") {
            item.level = "medium";
            item.isAlert = false;
          }
          if (!item.category || item.category === "general") {
            item.category = "trans";
          }
        }
        for (const [category, items] of results) {
          results.set(
            category,
            items.filter(
              (item) => item.scanAllWithBedrock !== true || isTransRelevant(item) || aiKeep.has(item)
            )
          );
        }
        allItems = [...results.values()].flat();
      }
    }
    const corroborationMap = /* @__PURE__ */ new Map();
    await Promise.all(allItems.map(async (item) => {
      const hash = await sha256Hex(normalizeTitle(item.title));
      item.titleHash = hash;
      const sources = corroborationMap.get(hash) ?? /* @__PURE__ */ new Set();
      sources.add(item.source);
      corroborationMap.set(hash, sources);
    }));
    for (const item of allItems) {
      item.corroborationCount = corroborationMap.get(item.titleHash)?.size ?? 1;
    }
    await enrichWithAiCache(allItems);
    for (const item of allItems) {
      item.importanceScore = computeImportanceScore(
        item.level,
        item.source,
        item.corroborationCount,
        item.publishedAt
      );
    }
    const JACCARD_THRESHOLD = 0.18;
    const titleWords = /* @__PURE__ */ new Map();
    for (const item of allItems) {
      titleWords.set(item, extractStoryKey(item.title) ? new Set(extractStoryKey(item.title).split(" ")) : /* @__PURE__ */ new Set());
    }
    const parent = /* @__PURE__ */ new Map();
    const getRoot = (x) => {
      if (parent.get(x) === x) return x;
      const root = getRoot(parent.get(x));
      parent.set(x, root);
      return root;
    };
    for (const item of allItems) parent.set(item, item);
    const itemList = allItems;
    for (let i = 0; i < itemList.length; i++) {
      for (let j = i + 1; j < itemList.length; j++) {
        const a = titleWords.get(itemList[i]);
        const b = titleWords.get(itemList[j]);
        if (a.size === 0 || b.size === 0) continue;
        let intersection = 0;
        for (const w of a) {
          if (b.has(w)) intersection++;
        }
        const union = a.size + b.size - intersection;
        if (intersection / union >= JACCARD_THRESHOLD) {
          const ra = getRoot(itemList[i]);
          const rb = getRoot(itemList[j]);
          if (ra !== rb) parent.set(ra, rb);
        }
      }
    }
    const clusterWinner = /* @__PURE__ */ new Map();
    for (const item of allItems) {
      const root = getRoot(item);
      const current = clusterWinner.get(root);
      if (!current || item.importanceScore > current.importanceScore) {
        clusterWinner.set(root, item);
      }
    }
    const clusterSources = /* @__PURE__ */ new Map();
    for (const item of allItems) {
      const root = getRoot(item);
      const sources = clusterSources.get(root) ?? /* @__PURE__ */ new Set();
      sources.add(item.source);
      clusterSources.set(root, sources);
    }
    for (const item of allItems) {
      const root = getRoot(item);
      const mergedCount = clusterSources.get(root)?.size ?? item.corroborationCount;
      if (mergedCount > item.corroborationCount) {
        item.corroborationCount = mergedCount;
        item.importanceScore = computeImportanceScore(
          item.level,
          item.source,
          mergedCount,
          item.publishedAt
        );
      }
    }
    const winningHashes = new Set(
      [...clusterWinner.values()].map((i) => i.titleHash)
    );
    const slicedByCategory = /* @__PURE__ */ new Map();
    for (const [category, items] of results) {
      items.sort(
        (a, b) => b.importanceScore - a.importanceScore || b.publishedAt - a.publishedAt
      );
      const dedupedItems = cleanLiveDigestItems(
        items.filter((item) => winningHashes.has(item.titleHash))
      );
      slicedByCategory.set(category, dedupedItems.slice(0, MAX_ITEMS_PER_CATEGORY));
    }
    const globalBestCategory = /* @__PURE__ */ new Map();
    for (const [category, items] of slicedByCategory) {
      for (const item of items) {
        const hash = item.titleHash;
        const existing = globalBestCategory.get(hash);
        if (!existing || item.importanceScore > existing.score) {
          globalBestCategory.set(hash, { category, score: item.importanceScore });
        }
      }
    }
    for (const [category, items] of slicedByCategory) {
      slicedByCategory.set(
        category,
        items.filter((item) => globalBestCategory.get(item.titleHash)?.category === category)
      );
    }
    const allSliced = [...slicedByCategory.values()].flat();
    const titleHashes = allSliced.map((i) => i.titleHash);
    const now = Date.now();
    const uniqueHashes = [...new Set(titleHashes)];
    const storyTracks = await readStoryTracks(uniqueHashes).catch(() => /* @__PURE__ */ new Map());
    await writeStoryTracking(allSliced, variant, lang, titleHashes).catch(
      (err) => console.warn("[digest] story tracking write failed:", err)
    );
    const seenGlobalBiasDomains = /* @__PURE__ */ new Set();
    const directBiasTargets = allItems.filter((item) => item.link && (item.scanAllWithBedrock === true || isGoogleNewsUrl(item.link)) && canResolveBiasDomain(item)).filter((item) => isTransRelevant({ title: `${item.title} ${item.summary ?? ""}` })).sort((a, b) => b.importanceScore - a.importanceScore || b.publishedAt - a.publishedAt).filter((item) => {
      const domain = extractBiasDomain(item.link, item.source, item.title);
      if (!domain || seenGlobalBiasDomains.has(domain)) return false;
      seenGlobalBiasDomains.add(domain);
      return true;
    });
    const biasTargetsToEnqueue = [...directBiasTargets];
    const TRANS_FILTERED_CATEGORIES = /* @__PURE__ */ new Set(["community", "legal", "mainstream", "safety", "international", "uk-press", "wins"]);
    const AI_FILTER_CHUNK = Number(process.env.AI_FILTER_CHUNK ?? "40");
    const keywordPassedByCategory = /* @__PURE__ */ new Map();
    const keywordFailedByCategory = /* @__PURE__ */ new Map();
    const allKeywordFailed = [];
    for (const [category, sliced] of slicedByCategory) {
      if (variant !== "trans" || !TRANS_FILTERED_CATEGORIES.has(category)) continue;
      const passed = sliced.filter((item) => isTransRelevant(item));
      const failed = sliced.filter((item) => !isTransRelevant(item));
      keywordPassedByCategory.set(category, passed);
      keywordFailedByCategory.set(category, failed);
      for (const item of failed) allKeywordFailed.push(item);
    }
    const aiRescued = /* @__PURE__ */ new Set();
    if (allKeywordFailed.length > 0) {
      console.log(`[digest] ai rescue: ${allKeywordFailed.length} keyword-failed items across categories`);
      for (let i = 0; i < allKeywordFailed.length; i += AI_FILTER_CHUNK) {
        const chunk = allKeywordFailed.slice(i, i + AI_FILTER_CHUNK);
        const aiResults = await aiFilterTransRelevant(chunk).catch((err) => {
          console.warn("[digest] ai rescue chunk failed, dropping items:", err.message);
          return chunk.map(() => false);
        });
        chunk.forEach((item, j) => {
          if (aiResults[j]) aiRescued.add(item);
        });
      }
      console.log(`[digest] ai rescue passed=${aiRescued.size} rejected=${allKeywordFailed.length - aiRescued.size}`);
    }
    for (const [category, sliced] of slicedByCategory) {
      let filteredSliced = sliced;
      if (variant === "trans" && TRANS_FILTERED_CATEGORIES.has(category)) {
        const keywordPassed = keywordPassedByCategory.get(category) ?? [];
        const keywordFailed = keywordFailedByCategory.get(category) ?? [];
        const aiPassed = keywordFailed.filter((item) => aiRescued.has(item));
        filteredSliced = [...keywordPassed, ...aiPassed];
      }
      const categoryBiasTargets = filteredSliced.filter((item) => item.link && (item.scanAllWithBedrock === true || isGoogleNewsUrl(item.link)) && canResolveBiasDomain(item));
      for (const item of categoryBiasTargets) biasTargetsToEnqueue.push(item);
      categories[category] = {
        items: filteredSliced.map((item) => {
          const hash = item.titleHash;
          const sourceCount = corroborationMap.get(hash)?.size ?? 1;
          const stale = storyTracks.get(hash);
          const mentionCount = stale ? stale.mentionCount + 1 : 1;
          const firstSeen = stale?.firstSeen ?? now;
          const merged = {
            firstSeen,
            lastSeen: now,
            mentionCount,
            sourceCount,
            currentScore: stale?.currentScore ?? 0,
            peakScore: stale?.peakScore ?? 0
          };
          const storyMeta = {
            firstSeen,
            mentionCount,
            sourceCount,
            phase: derivePhase(merged)
          };
          return toProtoItem(item, storyMeta);
        })
      };
    }
    console.log("[digest] finished category loop, building hero/response");
    await enqueueBiasRefs(biasTargetsToEnqueue).catch(
      (err) => console.warn("[media-bias] digest enqueue batch failed:", err)
    );
    const hero = [...slicedByCategory.entries()].flatMap(([category, items]) => items.map((item) => ({ item, category }))).map(({ item, category }) => ({ item, category, score: heroScore(item, category) })).sort(
      (a, b) => b.score - a.score || Number(b.item.publishedAt ?? 0) - Number(a.item.publishedAt ?? 0)
    )[0];
    return {
      hero: hero ? toProtoItem(hero.item, {
        firstSeen: storyTracks.get(hero.item.titleHash)?.firstSeen ?? now,
        mentionCount: (storyTracks.get(hero.item.titleHash)?.mentionCount ?? 0) + 1,
        sourceCount: corroborationMap.get(hero.item.titleHash)?.size ?? 1,
        phase: derivePhase({
          firstSeen: storyTracks.get(hero.item.titleHash)?.firstSeen ?? now,
          lastSeen: now,
          mentionCount: (storyTracks.get(hero.item.titleHash)?.mentionCount ?? 0) + 1,
          sourceCount: corroborationMap.get(hero.item.titleHash)?.size ?? 1,
          currentScore: storyTracks.get(hero.item.titleHash)?.currentScore ?? 0,
          peakScore: storyTracks.get(hero.item.titleHash)?.peakScore ?? 0
        })
      }) : void 0,
      categories,
      feedStatuses,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  } finally {
    clearTimeout(deadlineTimeout);
  }
}
var VALID_VARIANTS_SET = /* @__PURE__ */ new Set(["full", "tech", "finance", "happy", "commodity", "trans"]);
var fallbackCache2 = /* @__PURE__ */ new Map();
var handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  const variant = VALID_VARIANTS_SET.has(event.queryStringParameters?.variant ?? "") ? event.queryStringParameters?.variant ?? "trans" : "trans";
  const lang = event.queryStringParameters?.lang ?? "en";
  const refresh = ["1", "true", "yes"].includes((event.queryStringParameters?.refresh ?? "").toLowerCase()) || ["1", "true", "yes"].includes((event.queryStringParameters?.force ?? "").toLowerCase()) || ["1", "true", "yes"].includes((event.queryStringParameters?.bypassCache ?? "").toLowerCase());
  const ctx = { request: {} };
  try {
    const result = await listFeedDigest(ctx, { variant, lang, refresh });
    if (fallbackCache2.size > 50) fallbackCache2.clear();
    fallbackCache2.set(`${variant}:${lang}`, { data: result, ts: Date.now() });
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=60" },
      body: JSON.stringify(result)
    };
  } catch (err) {
    console.error("[news-digest] error:", err);
    await pushover({
      token: process.env.PUSHOVER_TOKEN,
      user: process.env.PUSHOVER_USER,
      title: "\u{1F6A8} TransMonitor: News Digest Error",
      message: `news-digest handler failed: ${err.message ?? err}`,
      priority: 1
    });
    const fallback = fallbackCache2.get(`${variant}:${lang}`)?.data ?? { categories: {}, feedStatuses: {}, generatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    return { statusCode: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(fallback) };
  }
};
function isGoogleNewsUrlForDisplay(url) {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, "").replace(/^amp\./, "").replace(/^m\./, "");
    return h === "news.google.com" || h.endsWith(".google.com");
  } catch {
    return false;
  }
}
function extractPublisherSuffixForDisplay(title) {
  const match = title.match(/\s[-–—]\s([^—–-]{2,100})\s*$/);
  if (!match) return null;
  const publisher = match[1].trim();
  if (!publisher) return null;
  if (/^https?:\/\//i.test(publisher)) return null;
  if (publisher.length < 2 || publisher.length > 100) return null;
  return publisher;
}
function cleanGoogleNewsTitleForDisplay(title) {
  return title.replace(/\s[-–—]\s([^—–-]{2,100})\s*$/, "").trim();
}
function inferDigestDisplaySource(feedSource, link, title) {
  if (!isGoogleNewsUrlForDisplay(link)) return feedSource;
  const publisher = extractPublisherSuffixForDisplay(title);
  return publisher ?? feedSource;
}
async function enqueueBiasRefs(items) {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return 0;
  const seenDomains = /* @__PURE__ */ new Set();
  const refs = [];
  for (const item of items) {
    const url = item.link ?? "";
    if (!url) continue;
    const titleClean = (item.title ?? "").trim();
    if (titleClean.length < 20 || titleClean === item.source) continue;
    const domain = extractBiasDomain(url, item.source, item.title);
    if (!domain || seenDomains.has(domain)) continue;
    seenDomains.add(domain);
    const ref = {
      url,
      title: item.title,
      source: item.source,
      publishedAt: item.publishedAt,
      summary: item.summary
    };
    refs.push(JSON.stringify(ref));
  }
  if (refs.length === 0) return 0;
  const redis = (0, import_redis2.createClient)({ url: redisUrl });
  try {
    await redis.connect();
    await redis.rPush(BIAS_QUEUE_KEY, refs);
    await redis.lTrim(BIAS_QUEUE_KEY, -BIAS_QUEUE_MAX, -1);
    console.log(`[media-bias] enqueued ${refs.length} bias refs from digest`);
  } catch (err) {
    console.warn("[media-bias] digest enqueue failed (non-fatal):", err.message);
  } finally {
    await redis.disconnect().catch(() => {
    });
  }
  return refs.length;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler,
  listFeedDigest
});
