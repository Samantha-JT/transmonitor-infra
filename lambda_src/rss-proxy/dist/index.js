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

// rss-proxy/index.mjs
var index_exports = {};
__export(index_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(index_exports);
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
var DIRECT_FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/rss+xml, application/xml, text/xml, */*",
  "Accept-Language": "en-US,en;q=0.9"
};
var handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  const feedUrl = event.queryStringParameters?.url;
  if (!feedUrl) {
    return { statusCode: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Missing url parameter" }) };
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(feedUrl);
  } catch {
    return { statusCode: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Invalid URL" }) };
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return { statusCode: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Protocol not allowed" }) };
  }
  const isGoogleNews = parsedUrl.hostname === "news.google.com";
  const timeout = isGoogleNews ? 2e4 : 12e3;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(feedUrl, { headers: DIRECT_FETCH_HEADERS, signal: controller.signal, redirect: "follow" });
    const data = await response.text();
    const contentType = response.headers.get("content-type") || "application/xml";
    const isSuccess = response.status >= 200 && response.status < 300;
    const browserTtl = isGoogleNews ? 600 : 180;
    const cdnTtl = isGoogleNews ? 3600 : 900;
    return {
      statusCode: response.status,
      headers: { ...CORS_HEADERS, "Content-Type": contentType, "Cache-Control": isSuccess ? `public, max-age=${browserTtl}, s-maxage=${cdnTtl}, stale-while-revalidate=300` : "public, max-age=15, s-maxage=60" },
      body: data
    };
  } catch (error) {
    const isTimeout = error.name === "AbortError";
    return { statusCode: isTimeout ? 504 : 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ error: isTimeout ? "Feed timeout" : "Failed to fetch feed", details: error.message }) };
  } finally {
    clearTimeout(timer);
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
