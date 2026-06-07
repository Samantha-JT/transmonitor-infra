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

// ai-insights/index.mjs
var index_exports = {};
__export(index_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(index_exports);
var import_redis = require("redis");
var import_client_ssm = require("@aws-sdk/client-ssm");
var ssmClient = new import_client_ssm.SSMClient({ region: process.env.AWS_REGION });
var redisClient = null;
var cachedSecrets = null;
async function getRedis() {
  if (redisClient && redisClient.isOpen) return redisClient;
  redisClient = (0, import_redis.createClient)({ url: process.env.REDIS_URL });
  await redisClient.connect();
  return redisClient;
}
async function getSecrets() {
  if (cachedSecrets) return cachedSecrets;
  const result = await ssmClient.send(new import_client_ssm.GetParametersByPathCommand({
    Path: process.env.SSM_PREFIX,
    WithDecryption: true
  }));
  cachedSecrets = Object.fromEntries(
    result.Parameters.map((p) => [p.Name.split("/").pop(), p.Value])
  );
  return cachedSecrets;
}
var handler = async (event) => {
  const body = JSON.parse(event.body ?? "{}");
  const { prompt, variant = "trans" } = body;
  if (!prompt) {
    return { statusCode: 400, body: JSON.stringify({ error: "prompt required" }) };
  }
  const cacheKey = `insights:${variant}:${Buffer.from(prompt).toString("base64").slice(0, 40)}`;
  try {
    const redis = await getRedis();
    const cached = await redis.get(cacheKey);
    if (cached) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "X-Cache": "HIT" },
        body: cached
      };
    }
  } catch (e) {
    console.warn("Redis unavailable:", e.message);
  }
  const secrets = await getSecrets();
  const apiKey = secrets.openrouter_api_key;
  if (!apiKey) {
    return { statusCode: 503, body: JSON.stringify({ error: "No AI provider configured" }) };
  }
  const endpoint = "https://openrouter.ai/api/v1/chat/completions";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "mistralai/mistral-7b-instruct",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 512
    })
  });
  const data = await response.json();
  const result = JSON.stringify({ insight: data.choices?.[0]?.message?.content ?? "" });
  try {
    const redis = await getRedis();
    await redis.set(cacheKey, result, { EX: 3600 });
  } catch {
  }
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: result
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
