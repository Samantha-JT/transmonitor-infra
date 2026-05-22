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

// lambda_src/economic/index.ts
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
var CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, x-origin-verify" };
var ok = (body, ttl = 60) => ({ statusCode: 200, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}, stale-while-revalidate=60` }, body: JSON.stringify(body) });
var ALLOWED_FRED = /* @__PURE__ */ new Set(["WALCL", "FEDFUNDS", "T10Y2Y", "UNRATE", "CPIAUCSL", "DGS10", "VIXCLS", "GDP", "M2SL", "DCOILWTICO", "BAMLH0A0HYM2", "ICSA", "MORTGAGE30US", "GSCPI", "T10Y3M", "STLFSI4", "DGS1MO", "DGS3MO", "DGS6MO", "DGS1", "DGS2", "DGS5", "DGS30", "BAMLC0A0CM", "SOFR", "ESTR", "EURIBOR3M", "EURIBOR6M", "EURIBOR1Y"]);
var handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const path = event.rawPath || event.path || "";
  const method = event.requestContext?.http?.method || "GET";
  try {
    if (path.endsWith("/get-macro-signals")) return ok(await redisGet("economic:macro-signals:v1") ?? { verdict: "UNKNOWN", bullishCount: 0, totalCount: 0, signals: {}, meta: {}, unavailable: true, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
    if (path.endsWith("/list-bigmac-prices")) return ok(await redisGet("economic:bigmac:v1") ?? { prices: [] });
    if (path.endsWith("/list-fuel-prices")) return ok(await redisGet("economic:fuel-prices:v1") ?? { prices: [] });
    if (path.endsWith("/list-grocery-basket-prices")) return ok(await redisGet("economic:grocery-basket:v1") ?? { items: [] });
    if (path.endsWith("/get-economic-calendar")) return ok(await redisGet("economic:econ-calendar:v1") ?? { events: [] });
    if (path.endsWith("/get-eurostat-country-data")) return ok(await redisGet("economic:eurostat-country-data:v1") ?? { countries: {}, seededAt: "0", unavailable: true });
    if (path.endsWith("/get-energy-crisis-policies")) return ok(await redisGet("energy:crisis-policies:v1") ?? { policies: [] });
    if (path.endsWith("/get-eu-yield-curve")) return ok(await redisGet("economic:eu-yield-curve:v1") ?? { tenors: [] });
    if (path.endsWith("/get-fao-food-price-index")) return ok(await redisGet("economic:fao-food-price:v1") ?? { indices: [] });
    if (path.endsWith("/get-crude-inventories")) return ok(await redisGet("economic:crude-inventories:v1") ?? { weeks: [], upstreamUnavailable: true });
    if (path.endsWith("/get-nat-gas-storage")) return ok(await redisGet("economic:nat-gas-storage:v1") ?? { weeks: [], latestPeriod: "", upstreamUnavailable: true });
    if (path.endsWith("/get-ecb-fx-rates")) return ok(await redisGet("economic:ecb-fx-rates:v1") ?? { rates: [] });
    if (path.endsWith("/get-eu-gas-storage")) return ok(await redisGet("economic:eu-gas-storage:v1") ?? {});
    if (path.endsWith("/get-national-debt")) return ok(await redisGet("economic:national-debt:v1") ?? {});
    if (path.endsWith("/get-bis-policy-rates")) return ok(await redisGet("economic:bis-policy-rates:v1") ?? { rates: [] });
    if (path.endsWith("/get-bis-exchange-rates")) return ok(await redisGet("economic:bis-exchange-rates:v1") ?? { rates: [] });
    if (path.endsWith("/get-bis-credit")) return ok(await redisGet("economic:bis-credit:v1") ?? {});
    if (path.endsWith("/get-economic-stress")) return ok(await redisGet("economic:stress:v1") ?? {});
    if (path.endsWith("/get-fred-series-batch")) {
      let body = {};
      if (event.body) {
        try {
          body = JSON.parse(event.body);
        } catch {
        }
      }
      const ids = (body.seriesIds || body.series_ids || []).map((s) => s.trim().toUpperCase()).filter((s) => ALLOWED_FRED.has(s)).slice(0, 20);
      const settled = await Promise.allSettled(ids.map((id) => redisGet(`fred:seed:${id}:v1`)));
      const results = {};
      for (let i = 0; i < ids.length; i++) {
        const r = settled[i];
        if (r.status === "fulfilled" && r.value?.series) results[ids[i]] = r.value.series;
      }
      return ok({ results, fetched: Object.keys(results).length, requested: ids.length });
    }
    return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "Not found" }) };
  } catch (e) {
    console.error("[economic]", e?.message);
    return ok({});
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
