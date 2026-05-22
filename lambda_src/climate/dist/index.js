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

// climate/index.ts
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
var ok = (body, ttl = 300) => ({ statusCode: 200, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}, stale-while-revalidate=60` }, body: JSON.stringify(body) });
var handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const path = event.rawPath || event.path || "";
  try {
    if (path.endsWith("/list-climate-news")) return ok(await redisGet("climate:news-intelligence:v1") ?? { items: [], fetchedAt: 0 }, 300);
    if (path.endsWith("/list-climate-anomalies")) return ok(await redisGet("climate:anomalies:v2") ?? { anomalies: [] }, 600);
    if (path.endsWith("/list-climate-disasters")) return ok(await redisGet("climate:disasters:v1") ?? { events: [] }, 600);
    if (path.endsWith("/get-co2-monitoring")) return ok(await redisGet("climate:co2-monitoring:v1") ?? {}, 3600);
    if (path.endsWith("/get-ocean-ice-data")) return ok(await redisGet("climate:ocean-ice:v1") ?? {}, 3600);
    if (path.endsWith("/list-air-quality-data")) return ok(await redisGet("climate:air-quality:v1") ?? { stations: [] }, 300);
    return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "Not found" }) };
  } catch (e) {
    console.error("[climate]", e?.message);
    return ok({});
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
