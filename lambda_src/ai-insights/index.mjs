import { createClient } from "redis";
import { SSMClient, GetParametersByPathCommand } from "@aws-sdk/client-ssm";

const ssmClient = new SSMClient({ region: process.env.AWS_REGION });

let redisClient = null;
let cachedSecrets = null;

async function getRedis() {
  if (redisClient && redisClient.isOpen) return redisClient;
  redisClient = createClient({ url: process.env.REDIS_URL });
  await redisClient.connect();
  return redisClient;
}

async function getSecrets() {
  if (cachedSecrets) return cachedSecrets;
  const result = await ssmClient.send(new GetParametersByPathCommand({
    Path: process.env.SSM_PREFIX,
    WithDecryption: true,
  }));
  cachedSecrets = Object.fromEntries(
    result.Parameters.map(p => [p.Name.split("/").pop(), p.Value])
  );
  return cachedSecrets;
}

export const handler = async (event) => {
  const body = JSON.parse(event.body ?? "{}");
  const { prompt, variant = "trans" } = body;

  if (!prompt) {
    return { statusCode: 400, body: JSON.stringify({ error: "prompt required" }) };
  }

  // Deduplicate identical prompts via Redis
  const cacheKey = `insights:${variant}:${Buffer.from(prompt).toString("base64").slice(0, 40)}`;
  try {
    const redis = await getRedis();
    const cached = await redis.get(cacheKey);
    if (cached) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "X-Cache": "HIT" },
        body: cached,
      };
    }
  } catch (e) {
    console.warn("Redis unavailable:", e.message);
  }

  const secrets = await getSecrets();
  const apiKey = secrets.groq_api_key || secrets.openrouter_api_key;
  if (!apiKey) {
    return { statusCode: 503, body: JSON.stringify({ error: "No AI provider configured" }) };
  }

  // Call Groq (or OpenRouter as fallback — same OpenAI-compatible API shape)
  const isGroq = !!secrets.groq_api_key;
  const endpoint = isGroq
    ? "https://api.groq.com/openai/v1/chat/completions"
    : "https://openrouter.ai/api/v1/chat/completions";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: isGroq ? "llama-3.1-8b-instant" : "mistralai/mistral-7b-instruct",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 512,
    }),
  });

  const data = await response.json();
  const result = JSON.stringify({ insight: data.choices?.[0]?.message?.content ?? "" });

  try {
    const redis = await getRedis();
    await redis.set(cacheKey, result, { EX: 3600 });
  } catch {}

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: result,
  };
};
