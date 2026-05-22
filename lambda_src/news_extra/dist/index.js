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

// lambda_src/news_extra/index.ts
var index_exports = {};
__export(index_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(index_exports);
var import_redis = require("redis");
var import_client_bedrock_runtime = require("@aws-sdk/client-bedrock-runtime");
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
async function redisSetEx(key, ttl, value) {
  const redis = await getClient();
  await redis.set(key, value, { EX: ttl });
}
var CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, x-origin-verify" };
var ok = (body) => ({ statusCode: 200, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) });
var EMPTY_MISS = { summary: "", model: "", provider: "", tokens: 0, fallback: true, error: "", errorType: "", status: "SUMMARIZE_STATUS_UNSPECIFIED", statusDetail: "" };
var CACHE_KEY_PATTERN = /^summary:v\d+:[a-z0-9:_-]{3,120}$/;
var bedrock = new import_client_bedrock_runtime.BedrockRuntimeClient({ region: "eu-west-1" });
var BEDROCK_MODEL = "eu.anthropic.claude-haiku-4-5-20251001-v1:0";
async function summariseWithBedrock(headlines, mode) {
  try {
    const prompt = `Summarize the top news story from these headlines in 2-3 sentences. Be factual and concise.

${headlines.slice(0, 5).join("\n")}`;
    const body = JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 150,
      messages: [{ role: "user", content: prompt }]
    });
    const cmd = new import_client_bedrock_runtime.InvokeModelCommand({
      modelId: BEDROCK_MODEL,
      contentType: "application/json",
      accept: "application/json",
      body
    });
    const resp = await bedrock.send(cmd);
    const result = JSON.parse(new TextDecoder().decode(resp.body));
    const text = result.content?.[0]?.text?.trim();
    if (!text) return null;
    return { summary: text, model: BEDROCK_MODEL, tokens: (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0) };
  } catch (e) {
    console.error("[Bedrock]", e?.message);
    return null;
  }
}
var handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const path = event.rawPath || event.path || "";
  const qs = event.queryStringParameters || {};
  try {
    if (path.endsWith("/summarize-article-cache") || path.endsWith("/get-summarize-article-cache")) {
      const cacheKey = qs.cache_key || qs.cacheKey || "";
      if (!cacheKey || !CACHE_KEY_PATTERN.test(cacheKey)) {
        return ok({ ...EMPTY_MISS, status: "SUMMARIZE_STATUS_ERROR", error: "Invalid cache key" });
      }
      const cached = await redisGet(cacheKey).catch(() => null);
      if (cached?.summary) {
        return ok({ summary: cached.summary, model: cached.model || "", provider: "cache", tokens: 0, fallback: false, error: "", errorType: "", status: "SUMMARIZE_STATUS_CACHED", statusDetail: "" });
      }
      return ok(EMPTY_MISS);
    }
    if (path.endsWith("/summarize-article")) {
      let body = {};
      if (event.body) {
        try {
          body = JSON.parse(event.body);
        } catch {
        }
      }
      const { headlines = [], mode = "brief", variant = "trans", lang = "en" } = body;
      if (!headlines.length) return ok({ ...EMPTY_MISS, status: "SUMMARIZE_STATUS_ERROR", error: "Headlines required" });
      const cacheKey = `summarize:v1:${mode}:${variant}:${lang}:${Buffer.from(headlines.slice(0, 5).join("|")).toString("base64").slice(0, 32)}`;
      const cached = await redisGet(cacheKey).catch(() => null);
      if (cached?.summary) return ok({ ...cached, provider: "cache", tokens: 0, fallback: false, status: "SUMMARIZE_STATUS_CACHED", statusDetail: "" });
      const result = await summariseWithBedrock(headlines, mode);
      if (result) {
        await redisSetEx(cacheKey, 3600, JSON.stringify(result)).catch(() => {
        });
        return ok({ ...result, provider: "bedrock", fallback: false, error: "", errorType: "", status: "SUMMARIZE_STATUS_SUCCESS", statusDetail: "" });
      }
      return ok({ ...EMPTY_MISS, status: "SUMMARIZE_STATUS_ERROR", error: "Bedrock invocation failed" });
    }
    return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "Not found" }) };
  } catch (e) {
    console.error("[news_extra]", e?.message);
    return ok(EMPTY_MISS);
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
