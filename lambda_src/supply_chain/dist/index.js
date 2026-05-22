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

// supply_chain/index.ts
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
  const qs = event.queryStringParameters || {};
  try {
    if (path.includes("/hormuz-tracker") || path.endsWith("/get-chokepoint-status")) return ok(await redisGet("supply_chain:chokepoints:v4") ?? { chokepoints: [] }, 300);
    if (path.endsWith("/get-shipping-rates")) return ok(await redisGet("supply_chain:shipping:v2") ?? { indices: [], fetchedAt: (/* @__PURE__ */ new Date()).toISOString(), upstreamUnavailable: true }, 300);
    if (path.endsWith("/get-critical-minerals")) return ok(await redisGet("supply_chain:minerals:v2") ?? { minerals: [] }, 3600);
    if (path.endsWith("/get-shipping-stress")) return ok(await redisGet("supply_chain:shipping_stress:v1") ?? {}, 300);
    if (path.endsWith("/get-country-chokepoint-index")) {
      const iso2 = qs.iso2 || path.split("/").pop() || "";
      return ok(await redisGet(`supply-chain:exposure:${iso2}:all:v1`) ?? {}, 600);
    }
    if (path.endsWith("/get-country-cost-shock")) {
      return ok(await redisGet(`supply-chain:cost-shock:${qs.iso2 || ""}:${qs.chokepointId || ""}:v1`) ?? {}, 600);
    }
    return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "Not found" }) };
  } catch (e) {
    console.error("[supply_chain]", e?.message);
    return ok({});
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
