import { createClient } from "redis";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({ region: process.env.AWS_REGION });
let redisClient = null;

async function getRedis() {
  if (redisClient && redisClient.isOpen) return redisClient;
  redisClient = createClient({
    url: process.env.REDIS_URL,
    socket: { tls: true },
  });
  await redisClient.connect();
  return redisClient;
}

export const handler = async (event) => {
  const variant = event.pathParameters?.variant ?? "trans";
  const cacheKey = `digest:${variant}`;

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
    console.warn("Redis miss or error:", e.message);
  }

  try {
    const obj = await s3.send(new GetObjectCommand({
      Bucket: process.env.DIGEST_BUCKET,
      Key: `cache/${variant}/digest.json`,
    }));
    const body = await obj.Body.transformToString();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "X-Cache": "S3" },
      body,
    };
  } catch (e) {
    console.error("S3 miss:", e.message);
    return {
      statusCode: 503,
      body: JSON.stringify({ error: "Digest not yet available" }),
    };
  }
};
