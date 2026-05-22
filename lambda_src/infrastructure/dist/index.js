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

// lambda_src/infrastructure/index.ts
var index_exports = {};
__export(index_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(index_exports);
var import_redis = require("redis");
var client = null;
async function getClient() {
  if (client && client.isOpen) return client;
  client = (0, import_redis.createCluster)({ rootNodes: [{ url: process.env.REDIS_URL }], defaults: { socket: { tls: true } } });
  await client.connect();
  return client;
}
async function redisGet(key) {
  const redis = await getClient();
  const raw = await redis.get(key);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (parsed && typeof parsed === "object" && "_seed" in parsed && "data" in parsed) return parsed.data;
  return parsed;
}
async function redisSetNx(key, ttl, value) {
  const redis = await getClient();
  const result = await redis.set(key, value, { NX: true, EX: ttl });
  return result === "OK";
}
async function redisSet(key, ttl, value) {
  const redis = await getClient();
  await redis.set(key, value, { EX: ttl });
}
var CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, x-origin-verify" };
var ok = (body, ttl = 60) => ({ statusCode: 200, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}, stale-while-revalidate=60` }, body: JSON.stringify(body) });
var TEMPORAL_ANOMALIES_KEY = "infra:temporal-anomalies:v2";
var TEMPORAL_ANOMALIES_TTL = 300;
var BASELINE_LOCK_KEY = "infra:baseline-lock";
var BASELINE_LOCK_TTL = 60;
var MIN_SAMPLES = 5;
var Z_LOW = 1.5;
var Z_MED = 2;
var Z_HIGH = 2.5;
var COUNT_SOURCE_KEYS = {
  news: "news:digest:v1:trans:en",
  satellite_fires: "wildfire:nasa-firms:v1"
};
function makeBaselineKey(type, region, weekday, month) {
  return `infra:baseline:v2:${type}:${region}:wd${weekday}:m${month}`;
}
function getSeverity(z) {
  if (z >= Z_HIGH) return "critical";
  if (z >= Z_MED) return "high";
  if (z >= Z_LOW) return "medium";
  return "normal";
}
var handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const path = event.rawPath || event.path || "";
  const qs = event.queryStringParameters || {};
  try {
    if (path === "/bootstrap" || path.startsWith("/bootstrap")) {
      const tier = qs.tier || "";
      const keys = (qs.keys || "").split(",").filter(Boolean);
      const data = await redisGet(`infra:bootstrap:${tier || keys.join(",")}:v1`).catch(() => null);
      return ok(data ?? {}, 60);
    }
    if (path.endsWith("/list-temporal-anomalies")) {
      const cached = await redisGet(TEMPORAL_ANOMALIES_KEY).catch(() => null);
      if (cached?.computedAt) {
        const age = Date.now() - new Date(cached.computedAt).getTime();
        if (age < TEMPORAL_ANOMALIES_TTL * 1e3) return ok(cached, 60);
      }
      const locked = await redisSetNx(BASELINE_LOCK_KEY, BASELINE_LOCK_TTL, "1").catch(() => false);
      if (!locked) return ok(cached ?? { anomalies: [], trackedTypes: [], computedAt: "" }, 30);
      const now = /* @__PURE__ */ new Date();
      const weekday = now.getUTCDay();
      const month = now.getUTCMonth() + 1;
      const trackedTypes = Object.keys(COUNT_SOURCE_KEYS);
      const anomalies = [];
      const counts = {};
      for (const [type, sourceKey] of Object.entries(COUNT_SOURCE_KEYS)) {
        const data = await redisGet(sourceKey).catch(() => null);
        if (!data) continue;
        if (type === "news") counts[type] = data.topStories?.length ?? 0;
        else if (type === "satellite_fires") counts[type] = data.fireDetections?.length ?? 0;
      }
      const typesWithCounts = trackedTypes.filter((t) => counts[t] !== void 0);
      const baselines = await Promise.all(
        typesWithCounts.map((t) => redisGet(makeBaselineKey(t, "global", weekday, month)).catch(() => null))
      );
      for (let i = 0; i < typesWithCounts.length; i++) {
        const type = typesWithCounts[i];
        const count = counts[type];
        const bl = baselines[i];
        if (bl && bl.sampleCount >= MIN_SAMPLES) {
          const variance = Math.max(0, bl.m2 / (bl.sampleCount - 1));
          const stdDev = Math.sqrt(variance);
          const zScore = stdDev > 0 ? Math.abs((count - bl.mean) / stdDev) : 0;
          if (zScore >= Z_LOW) {
            const multiplier = bl.mean > 0 ? Math.round(count / bl.mean * 100) / 100 : count > 0 ? 999 : 1;
            anomalies.push({ type, region: "global", currentCount: count, expectedCount: Math.round(bl.mean), zScore: Math.round(zScore * 100) / 100, severity: getSeverity(zScore), multiplier, message: `${type} ${multiplier.toFixed(1)}x normal` });
          }
        }
        const prev = bl || { mean: 0, m2: 0, sampleCount: 0, lastUpdated: "" };
        const n = prev.sampleCount + 1;
        const delta = count - prev.mean;
        const newMean = prev.mean + delta / n;
        const delta2 = count - newMean;
        await redisSet(makeBaselineKey(type, "global", weekday, month), 86400 * 90, JSON.stringify({ mean: newMean, m2: prev.m2 + delta * delta2, sampleCount: n, lastUpdated: now.toISOString() })).catch(() => {
        });
      }
      const snapshot = { anomalies: anomalies.sort((a, b) => b.zScore - a.zScore), trackedTypes, computedAt: now.toISOString() };
      await redisSet(TEMPORAL_ANOMALIES_KEY, TEMPORAL_ANOMALIES_TTL, JSON.stringify(snapshot)).catch(() => {
      });
      return ok(snapshot, 60);
    }
    if (path.endsWith("/list-internet-outages")) {
      const data = await redisGet("infra:outages:v1");
      return ok(data ?? { outages: [] }, 300);
    }
    if (path.endsWith("/list-service-statuses")) {
      const data = await redisGet("infra:service-statuses:v1");
      return ok(data ?? { statuses: [] }, 120);
    }
    if (path.endsWith("/get-cable-health")) {
      const data = await redisGet("infra:cable-health:v1");
      return ok(data ?? { cables: [] }, 600);
    }
    if (path.endsWith("/list-ddos-attacks") || path.endsWith("/list-internet-ddos-attacks")) {
      const data = await redisGet("infra:ddos:v1");
      return ok(data ?? { attacks: [] }, 300);
    }
    if (path.endsWith("/list-traffic-anomalies") || path.endsWith("/list-internet-traffic-anomalies")) {
      const data = await redisGet("infra:traffic-anomalies:v1");
      return ok(data ?? { anomalies: [] }, 300);
    }
    if (path.endsWith("/get-bootstrap-data")) {
      const data = await redisGet("infra:bootstrap:v1");
      return ok(data ?? {}, 300);
    }
    return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "Not found" }) };
  } catch (e) {
    console.error("[infrastructure]", e?.message);
    return ok({ anomalies: [], trackedTypes: [], computedAt: "" });
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
