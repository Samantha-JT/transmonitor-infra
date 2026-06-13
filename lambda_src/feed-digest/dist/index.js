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

// feed-digest/index.mjs
var index_exports = {};
__export(index_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(index_exports);
var import_redis = require("redis");
var import_client_s3 = require("@aws-sdk/client-s3");
var s3 = new import_client_s3.S3Client({ region: process.env.AWS_REGION });
var redisClient = null;
async function getRedis() {
  if (redisClient && redisClient.isOpen) return redisClient;
  redisClient = (0, import_redis.createClient)({
    url: process.env.REDIS_URL,
    socket: { tls: true }
  });
  await redisClient.connect();
  return redisClient;
}
var handler = async (event) => {
  const variant = event.pathParameters?.variant ?? "trans";
  const cacheKey = `digest:${variant}`;
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
    console.warn("Redis miss or error:", e.message);
  }
  try {
    const obj = await s3.send(new import_client_s3.GetObjectCommand({
      Bucket: process.env.DIGEST_BUCKET,
      Key: `cache/${variant}/digest.json`
    }));
    const body = await obj.Body.transformToString();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "X-Cache": "S3" },
      body
    };
  } catch (e) {
    console.error("S3 miss:", e.message);
    return {
      statusCode: 503,
      body: JSON.stringify({ error: "Digest not yet available" })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
