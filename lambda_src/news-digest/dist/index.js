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
      { name: "Erin in the Morning", url: "https://www.erininthemorning.com/feed" },
      { name: "Trans Legislation Tracker", url: "https://translegislation.com/rss.xml" },
      { name: "ACLU LGBT News", url: "https://www.aclu.org/news/lgbtq-rights/feed" },
      { name: "Lambda Legal", url: gn("site:lambdalegal.org when:7d") },
      { name: "Law Dork", url: "https://www.lawdork.com/feed" },
      { name: "Good Law Project", url: "https://goodlawproject.org/feed/" },
      { name: "UK Trans Law", url: gnGB('("GRC" OR "Gender Recognition Act" OR "Cass Review" OR "Equality Act") UK when:3d') },
      { name: "US Trans Legislation", url: gn('("gender-affirming care ban" OR "trans bill" OR "bathroom bill" OR "drag ban") when:3d') },
      { name: "EU Gender Recognition", url: gn('("gender self-determination" OR "Ley Trans" OR "Selbstbestimmungsgesetz") when:7d') }
    ],
    healthcare: [
      { name: "Gender Analysis", url: "https://genderanalysis.net/feed/" },
      { name: "STAT News LGBTQ", url: "https://www.statnews.com/tag/lgbtq/feed/" },
      { name: "WPATH News", url: gn("site:wpath.org when:14d") },
      { name: "Cass Review Coverage", url: gn('("Cass Review" OR "Tavistock clinic") when:7d') },
      { name: "Trans Healthcare Access", url: gn('("transgender" OR "trans rights") ("gender-affirming care" OR "puberty blockers" OR "hormone therapy") when:3d') },
      { name: "Puberty Blocker Rulings", url: gn('"puberty blockers" (court OR ruling OR ban) when:7d') }
    ],
    community: [
      { name: "PinkNews", url: "https://www.thepinknews.com/feed/" },
      { name: "TransVitae", url: "https://www.transvitae.com/category/news/feed/" },
      { name: "Transgender Feed", url: "https://transgenderfeed.com/feed/" },
      { name: "TransLash", url: "https://translash.org/articles/feed/" },
      { name: "Erin in the Morning", url: "https://www.erininthemorning.com/feed" },
      { name: "Assigned Media", url: "https://www.assignedmedia.org/feed" },
      { name: "Trans Equality", url: "https://transequality.org/blog/feed" },
      { name: "Trans Law Center", url: "https://transgenderlawcenter.org/feed" },
      { name: "GLAAD", url: "https://glaad.org/feed/" },
      { name: "Them", url: "https://www.them.us/feed/rss" },
      { name: "TransActual UK", url: "https://transactual.org.uk/feed/" },
      { name: "TGEU News", url: "https://tgeu.org/feed/" },
      { name: "GATE Global", url: "https://gate.ngo/feed/" },
      { name: "Guardian Transgender", url: "https://www.theguardian.com/society/transgender/rss" },
      { name: "Independent Trans", url: "https://www.independent.co.uk/topic/transgender/rss" },
      { name: "LGBTQ Nation", url: "https://www.lgbtqnation.com/feed/" },
      { name: "Them", url: "https://www.them.us/feed/rss" },
      { name: "Xtra Magazine", url: "https://xtramagazine.com/feed" },
      { name: "Autostraddle", url: "https://www.autostraddle.com/feed/" },
      { name: "The 19th", url: "https://19thnews.org/category/lgbtq/feed/" },
      { name: "Assigned Media", url: "https://assignedmedia.org/feed" },
      { name: "TransLash News", url: "https://translash.org/feed" },
      { name: "What The Trans!?", url: "https://whatthetrans.com/feed/" },
      { name: "QueerAF", url: "https://queeraf.substack.com/feed" }
    ],
    international: [
      { name: "Reuters Trans Coverage", url: gn('site:reuters.com ("transgender" OR "trans rights") when:7d') },
      { name: "ILGA World", url: gn("site:ilga.org when:30d") },
      { name: "TGEU (Europe)", url: gn("site:tgeu.org when:30d") },
      { name: "Agencia Presentes", url: "https://agenciapresentes.org/feed/", lang: "es" },
      { name: "T\xEAtu", url: "https://tetu.com/feed/", lang: "fr" },
      { name: "LatAm Trans Rights", url: gn('("Ley de Identidad de Genero" OR "transgender rights" OR "travesti") when:7d') },
      { name: "Asia-Pacific Trans News", url: gn('("transgender" OR "hijra") (Thailand OR Japan OR Korea OR India) when:7d') }
    ],
    safety: [
      { name: "Trans Murder Monitoring", url: gn("site:transrespect.org when:30d") },
      { name: "TDoR / TDoV Coverage", url: gn('("Trans Day of Remembrance" OR "TDoR" OR "Trans Day of Visibility") when:30d') },
      { name: "Trans Violence News", url: gn('("transgender" OR "trans woman" OR "trans man") ("hate crime" OR "attacked" OR "murdered") when:3d') },
      { name: "UK Trans Safety", url: gnGB('("transgender" OR "trans") ("hate crime" OR "attack" OR "violence") UK when:7d') },
      { name: "HRC Violence Tracker", url: gn('site:hrc.org ("violence" OR "fatal" OR "transgender") when:30d') }
    ],
    "uk-press": [
      { name: "BBC News", url: gnGB('(transgender OR "trans rights" OR "Cass Review") site:bbc.co.uk when:3d') },
      { name: "The Guardian", url: gnGB('(transgender OR "trans rights") site:theguardian.com when:3d') },
      { name: "The Independent", url: gnGB('(transgender OR "trans rights") site:independent.co.uk when:3d') },
      { name: "Sky News", url: gnGB('(transgender OR "trans rights") site:news.sky.com when:30d') },
      { name: "Channel 4 News", url: gnGB('(transgender OR "trans rights") site:channel4.com when:30d') },
      { name: "The Times", url: gnGB('(transgender OR "trans rights" OR "Cass Review") site:thetimes.co.uk when:30d') },
      { name: "Daily Mail", url: gnGB('(transgender OR "trans rights") site:dailymail.co.uk when:3d') },
      { name: "The Telegraph", url: gnGB('(transgender OR "trans rights") site:telegraph.co.uk when:30d') },
      { name: "The Sun", url: gnGB('(transgender OR "trans rights") site:thesun.co.uk when:3d') },
      { name: "GB News", url: gnGB('(transgender OR "trans rights") site:gbnews.com when:3d') },
      { name: "Daily Mirror", url: gnGB('(transgender OR "trans rights") site:mirror.co.uk when:3d') },
      { name: "The Spectator", url: gnGB('(transgender OR "trans rights") site:spectator.co.uk when:30d') },
      { name: "The Times Trans", url: gnGB('(transgender OR "trans rights" OR "Cass Review") site:thetimes.co.uk when:30d') },
      { name: "The Telegraph Trans", url: gnGB('(transgender OR "trans rights") site:telegraph.co.uk when:30d') },
      { name: "Daily Express", url: gnGB('(transgender OR "trans rights") site:express.co.uk when:30d') },
      { name: "The i", url: gnGB('(transgender OR "trans rights") site:inews.co.uk when:30d') },
      { name: "HuffPost UK", url: gnGB('(transgender OR "trans rights") site:huffingtonpost.co.uk when:30d') },
      { name: "Metro Trans", url: gnGB('(transgender OR "trans rights") site:metro.co.uk when:30d') },
      { name: "TalkTV", url: gnGB('(transgender OR "trans rights") site:talk.tv when:30d') },
      { name: "ITV News", url: gnGB('(transgender OR "trans rights") site:itv.com when:3d') },
      { name: "Metro", url: gnGB('(transgender OR "trans rights") site:metro.co.uk when:3d') }
    ],
    wins: [
      { name: "Trans Wins", url: gnGB('(transgender OR "trans rights") (wins OR victory OR "first trans" OR milestone OR landmark) when:7d') },
      { name: "Trans Legal Wins", url: gn('(transgender OR "trans rights") (court OR judge) (blocks OR overturns) when:7d') }
    ],
    mainstream: [
      { name: "BBC Trans Coverage", url: gnGB('site:bbc.co.uk ("transgender" OR "trans rights" OR "Cass Review") when:3d') },
      { name: "Guardian Trans", url: gnGB('site:theguardian.com ("transgender" OR "trans rights") when:3d') },
      { name: "Reuters LGBT", url: gn('site:reuters.com ("transgender" OR "gender-affirming care") when:3d') },
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
var SYSTEM_PROMPT = `You are a relevance classifier for a transgender news dashboard. Given a JSON array of headlines, return a JSON array of booleans \u2014 true if the article's PRIMARY subject is transgender/nonbinary people, trans rights, gender identity policy, or trans healthcare. Return false if trans identity is merely mentioned incidentally (e.g. a trans athlete in a general sports story, or a trans person in a general crime story where their identity is not the focus). Respond ONLY with a JSON array of booleans, no other text.`;
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

// news-digest/index.ts
var import_client_bedrock_runtime2 = require("@aws-sdk/client-bedrock-runtime");
var import_redis3 = require("redis");
var markNoCacheResponse = (_req) => {
};
var CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var getRelayBaseUrl = () => null;
var getRelayHeaders = (h) => h;
var RSS_ACCEPT = "application/rss+xml, application/xml, text/xml, */*";
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
      source: feed.name,
      title,
      link,
      publishedAt,
      isAlert,
      level: threat.level,
      category: threat.category,
      confidence: threat.confidence,
      classSource: "keyword",
      importanceScore: 0,
      corroborationCount: 1,
      lang: feed.lang ?? "en"
    });
  }
  return items.length > 0 ? items : null;
}
var TAG_REGEX_CACHE = /* @__PURE__ */ new Map();
var KNOWN_TAGS = ["title", "link", "pubDate", "published", "updated"];
for (const tag of KNOWN_TAGS) {
  TAG_REGEX_CACHE.set(tag, {
    // Safer regexes with specific character classes to avoid catastrophic backtracking.
    cdata: new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`, "i"),
    plain: new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, "i")
  });
}
function extractTag(xml, tag) {
  const cached = TAG_REGEX_CACHE.get(tag);
  const cdataRe = cached?.cdata ?? new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`, "i");
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
    source: item.source,
    title: item.title,
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
  const digestCacheKey = `news:digest:v1:${variant}:${lang}`;
  const fallbackKey = `${variant}:${lang}`;
  const empty = () => ({ categories: {}, feedStatuses: {}, generatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  try {
    const fresh = await cachedFetchJson(
      digestCacheKey,
      900,
      async () => {
        const result = await buildDigest(variant, lang);
        const totalItems = Object.values(result.categories).reduce((sum, b) => sum + b.items.length, 0);
        return totalItems > 0 ? result : null;
      }
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
    const allItems = [...results.values()].flat();
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
      const dedupedItems = items.filter((item) => winningHashes.has(item.titleHash));
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
    for (const [category, sliced] of slicedByCategory) {
      const TRANS_FILTERED_CATEGORIES = /* @__PURE__ */ new Set(["community", "legal", "mainstream", "safety", "international", "uk-press", "wins"]);
      let filteredSliced = sliced;
      if (variant === "trans" && TRANS_FILTERED_CATEGORIES.has(category)) {
        const keywordPassed = sliced.filter((item) => isTransRelevant(item));
        const keywordFailed = sliced.filter((item) => !isTransRelevant(item));
        let aiPassed = [];
        if (keywordFailed.length > 0) {
          const aiResults = await aiFilterTransRelevant(keywordFailed).catch((err) => {
            console.warn("[digest] ai filter error, dropping failed items:", err.message);
            return keywordFailed.map(() => false);
          });
          aiPassed = keywordFailed.filter((_, i) => aiResults[i]);
        }
        filteredSliced = [...keywordPassed, ...aiPassed];
      }
      const biasTargets = filteredSliced.filter((item) => item.link);
      if (biasTargets.length > 0) {
        await Promise.race([
          Promise.allSettled(biasTargets.map((item) => scoreAndIngestBias(item))),
          new Promise((resolve) => setTimeout(resolve, 2e4))
        ]);
      }
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
    return {
      categories,
      feedStatuses,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  } finally {
    clearTimeout(deadlineTimeout);
  }
}
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
var VALID_VARIANTS_SET = /* @__PURE__ */ new Set(["full", "tech", "finance", "happy", "commodity", "trans"]);
var fallbackCache2 = /* @__PURE__ */ new Map();
var handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  const variant = VALID_VARIANTS_SET.has(event.queryStringParameters?.variant ?? "") ? event.queryStringParameters?.variant ?? "trans" : "trans";
  const lang = event.queryStringParameters?.lang ?? "en";
  const ctx = { request: {} };
  try {
    const result = await listFeedDigest(ctx, { variant, lang });
    if (fallbackCache2.size > 50) fallbackCache2.clear();
    fallbackCache2.set(`${variant}:${lang}`, { data: result, ts: Date.now() });
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=60" },
      body: JSON.stringify(result)
    };
  } catch (err) {
    console.error("[news-digest] error:", err);
    const fallback = fallbackCache2.get(`${variant}:${lang}`)?.data ?? { categories: {}, feedStatuses: {}, generatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    return { statusCode: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(fallback) };
  }
};
var BIAS_SOURCE_REGISTRY = /* @__PURE__ */ new Set([
  "dailymail.co.uk",
  "telegraph.co.uk",
  "thesun.co.uk",
  "spectator.co.uk",
  "gbnews.com",
  "talk.tv",
  "thetimes.co.uk",
  "express.co.uk",
  "theguardian.com",
  "independent.co.uk",
  "mirror.co.uk",
  "inews.co.uk",
  "bbc.co.uk",
  "channel4.com",
  "itv.com",
  "sky.com",
  "metro.co.uk",
  "huffingtonpost.co.uk",
  "vice.com",
  "pinknews.co.uk",
  "attitude.co.uk",
  "divamag.co.uk",
  "transactual.org.uk",
  "stonewall.org.uk"
]);
var BIAS_EDITORIAL = {
  // UK press
  "dailymail.co.uk": "hostile",
  "telegraph.co.uk": "hostile",
  "thesun.co.uk": "hostile",
  "spectator.co.uk": "hostile",
  "gbnews.com": "hostile",
  "talk.tv": "hostile",
  "thetimes.co.uk": "hostile",
  "express.co.uk": "negative",
  "theguardian.com": "negative",
  "bbc.co.uk": "negative",
  "itv.com": "negative",
  "independent.co.uk": "neutral",
  "mirror.co.uk": "neutral",
  "inews.co.uk": "neutral",
  "sky.com": "neutral",
  "metro.co.uk": "neutral",
  "channel4.com": "positive",
  "huffingtonpost.co.uk": "positive",
  "vice.com": "positive",
  // LGBTQ+ and trans-led media
  "pinknews.co.uk": "supportive",
  "attitude.co.uk": "supportive",
  "divamag.co.uk": "supportive",
  "them.us": "supportive",
  "transvitae.com": "supportive",
  "transgenderfeed.com": "supportive",
  "translash.org": "supportive",
  "erininthemorning.com": "supportive",
  "assignedmedia.org": "supportive",
  // Advocacy orgs
  "transactual.org.uk": "supportive",
  "stonewall.org.uk": "supportive",
  "transequality.org": "supportive",
  "transgenderlawcenter.org": "supportive",
  "glaad.org": "supportive",
  "tgeu.org": "supportive",
  "gate.ngo": "supportive"
};
var SOURCE_NAMES = {
  "dailymail.co.uk": "The Daily Mail",
  "telegraph.co.uk": "The Daily Telegraph",
  "thesun.co.uk": "The Sun",
  "spectator.co.uk": "The Spectator",
  "gbnews.com": "GB News",
  "talk.tv": "TalkTV",
  "thetimes.co.uk": "The Times",
  "express.co.uk": "Daily Express",
  "theguardian.com": "The Guardian",
  "independent.co.uk": "The Independent",
  "mirror.co.uk": "The Mirror",
  "inews.co.uk": "The i",
  "bbc.co.uk": "BBC News",
  "channel4.com": "Channel 4 News",
  "itv.com": "ITV News",
  "sky.com": "Sky News",
  "metro.co.uk": "Metro",
  "huffingtonpost.co.uk": "HuffPost UK",
  "vice.com": "Vice UK",
  "pinknews.co.uk": "Pink News",
  "attitude.co.uk": "Attitude",
  "divamag.co.uk": "DIVA Magazine",
  "transactual.org.uk": "TransActual",
  "stonewall.org.uk": "Stonewall",
  "transvitae.com": "TransVitae",
  "transgenderfeed.com": "Transgender Feed",
  "translash.org": "TransLash",
  "erininthemorning.com": "Erin in the Morning",
  "assignedmedia.org": "Assigned Media",
  "transequality.org": "Trans Equality",
  "transgenderlawcenter.org": "Trans Law Center",
  "glaad.org": "GLAAD",
  "them.us": "Them",
  "tgeu.org": "TGEU",
  "gate.ngo": "GATE Global"
};
var BIAS_SOURCE_NAME_MAP = {
  "BBC News": "bbc.co.uk",
  "BBC Trans Coverage": "bbc.co.uk",
  "The Guardian": "theguardian.com",
  "Guardian Trans": "theguardian.com",
  "The Independent": "independent.co.uk",
  "Sky News": "sky.com",
  "Channel 4 News": "channel4.com",
  "The Times": "thetimes.co.uk",
  "Times Trans": "thetimes.co.uk",
  "Daily Mail": "dailymail.co.uk",
  "Mail Trans": "dailymail.co.uk",
  "The Telegraph": "telegraph.co.uk",
  "The Sun": "thesun.co.uk",
  "GB News": "gbnews.com",
  "Pink News": "pinknews.co.uk",
  "PinkNews": "pinknews.co.uk",
  "The Mirror": "mirror.co.uk",
  "Daily Mirror": "mirror.co.uk",
  "Metro": "metro.co.uk",
  "Metro Trans": "metro.co.uk",
  "The Spectator": "spectator.co.uk",
  "ITV News": "itv.com",
  "The Times Trans": "thetimes.co.uk",
  "The Telegraph Trans": "telegraph.co.uk",
  "Daily Express": "express.co.uk",
  "The i": "inews.co.uk",
  "HuffPost UK": "huffingtonpost.co.uk",
  "TalkTV": "talk.tv",
  "TransVitae": "transvitae.com",
  "Transgender Feed": "transgenderfeed.com",
  "TransLash": "translash.org",
  "Assigned Media": "assignedmedia.org",
  "Trans Equality": "transequality.org",
  "Trans Law Center": "transgenderlawcenter.org",
  "GLAAD": "glaad.org",
  "Them": "them.us",
  "TransActual UK": "transactual.org.uk",
  "TGEU News": "tgeu.org",
  "GATE Global": "gate.ngo",
  "Guardian Transgender": "theguardian.com",
  "Independent Trans": "independent.co.uk"
};
function extractBiasDomain(url, sourceName) {
  if (sourceName && BIAS_SOURCE_NAME_MAP[sourceName]) {
    return BIAS_SOURCE_NAME_MAP[sourceName];
  }
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    for (const k of BIAS_SOURCE_REGISTRY) {
      if (h === k || h.endsWith("." + k)) return k;
    }
    return null;
  } catch {
    return null;
  }
}
function biasScoreToLabel(score) {
  if (score <= 20) return "hostile";
  if (score <= 40) return "negative";
  if (score <= 60) return "neutral";
  if (score <= 80) return "positive";
  return "supportive";
}
function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  return Math.abs(h).toString(16).padStart(8, "0");
}
async function scoreAndIngestBias(item) {
  const url = item.link ?? "";
  const domain = extractBiasDomain(url, item.source);
  if (!domain) return;
  const titleClean = item.title.trim();
  if (titleClean.length < 20) return;
  if (titleClean === item.source || titleClean === `- ${item.source}`) return;
  if (/^-\s*$/.test(titleClean)) return;
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return;
  try {
    const bedrock = new import_client_bedrock_runtime2.BedrockRuntimeClient({ region: "eu-west-1" });
    const editorialStance = BIAS_EDITORIAL[domain] ?? "neutral";
    const prompt = `You are a media bias analyst specialising in UK trans rights coverage.

STEP 1 \u2014 Relevance:
Mark relevant=true if the article is about transgender or non-binary people, gender identity, trans rights/policy, gender-critical activism, or directly related issues (Cass Review, GRA, puberty blockers, gender clinics, trans athletes, conversion therapy, EHRC trans guidance, single-sex spaces, gender recognition).

If the HEADLINE explicitly mentions "trans", "transgender", "non-binary", "gender identity", "gender-critical", or any of the above topics \u2192 relevant=true.

Mark relevant=false ONLY if there is no trans/gender content at all (general entertainment, celebrity gossip without trans angle, general politics/sport, LGB-only coverage with no trans dimension).

When in doubt, mark relevant=true.

STEP 2 \u2014 Bias scoring (only if relevant=true):
Score how THIS OUTLET frames the subject \u2014 not the subject matter itself.
This article is from a source with an editorial stance of "${editorialStance}" toward trans issues.
A supportive outlet reporting on hostile news should still score highly if their framing is fair, accurate, and does not amplify the hostile position uncritically.
A hostile outlet publishing a positive story should score lower if the broader framing remains dismissive.

0-20  = hostile    (misgendering, deadnaming, "groomer" framing, biological essentialism used to deny rights)
21-40 = negative   (sceptical framing, "debate" language, gender-critical voices given primary platform)
41-60 = neutral    (factual reporting, balanced, no strong framing)
61-80 = positive   (inclusive language, trans voices quoted, affirming framing)
81-100 = supportive (trans-led perspective, advocacy-adjacent, explicitly affirmative)

Title: ${item.title}

Respond ONLY with valid JSON, no markdown:
{"relevant": true|false, "score": <integer 0-100 if relevant else null>, "reason": "<one sentence max 20 words>"}`;
    const bedrockResult = await Promise.race([
      bedrock.send(new import_client_bedrock_runtime2.InvokeModelCommand({
        modelId: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 120,
          messages: [{ role: "user", content: prompt }]
        })
      })),
      new Promise((_, reject) => setTimeout(() => reject(new Error("bedrock_timeout")), 1e4))
    ]);
    const raw = JSON.parse(new TextDecoder().decode(bedrockResult.body));
    const rawText = (raw.content?.[0]?.text ?? "").trim().replace(/^```json\s*/, "").replace(/```\s*$/, "").trim();
    const parsed = JSON.parse(rawText);
    const score = Math.max(0, Math.min(100, Math.round(parsed.score)));
    const label = biasScoreToLabel(score);
    const reason = parsed.reason ?? "";
    const redis = (0, import_redis3.createClient)({ url: redisUrl });
    await redis.connect();
    fetch(`https://web.archive.org/save/${encodeURIComponent(url)}`, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(3e3)
    }).catch(() => {
    });
    const archiveUrl = `https://web.archive.org/web/*/${url}`;
    const record = JSON.stringify({
      id: simpleHash(url),
      url,
      archiveUrl,
      title: item.title,
      publishedAt: new Date(item.publishedAt).toISOString(),
      domain,
      score,
      label,
      reason,
      scoredAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    const articlesKey = `media:source:${domain}:articles`;
    const metaKey = `media:source:${domain}:meta`;
    const dedupKey = `media:dedup:${simpleHash(url)}`;
    if (parsed.relevant === false) {
      await redis.disconnect();
      return;
    }
    const alreadyScored = await redis.get(dedupKey);
    if (alreadyScored) {
      await redis.disconnect();
      return;
    }
    await redis.set(dedupKey, "1", { EX: 60 * 60 * 24 * 7 });
    await redis.lPush(articlesKey, record);
    await redis.lTrim(articlesKey, 0, 99);
    const meta = await redis.hGetAll(metaKey);
    let prevTotal = parseInt(meta?.totalScore ?? "0", 10);
    let prevCount = parseInt(meta?.articleCount ?? "0", 10);
    if (prevCount > 5 && prevTotal === 0) {
      prevTotal = 0;
      prevCount = 0;
    }
    const newCount = prevCount + 1;
    const newTotal = prevTotal + score;
    const avgScore = Math.round(newTotal / newCount);
    await redis.hSet(metaKey, {
      name: SOURCE_NAMES[domain] ?? domain,
      domain,
      editorialBias: BIAS_EDITORIAL[domain] ?? "neutral",
      articleCount: String(newCount),
      totalScore: String(newTotal),
      avgScore: String(avgScore),
      avgLabel: biasScoreToLabel(avgScore),
      lastSeenAt: new Date(item.publishedAt).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    await redis.sAdd("media:bias:index", domain);
    await redis.disconnect();
  } catch (err) {
    console.warn("[bias] score/ingest failed for", domain, err.message);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler,
  listFeedDigest
});
