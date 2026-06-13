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

// youtube-proxy/index.mjs
var index_exports = {};
__export(index_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(index_exports);
var handler = async (event) => {
  const channelId = event.pathParameters?.channelId;
  if (!channelId) {
    return { statusCode: 400, body: JSON.stringify({ error: "channelId required" }) };
  }
  const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const response = await fetch(rssUrl, {
    headers: { "User-Agent": "TransMonitor/2.0 feed-reader" }
  });
  if (!response.ok) {
    return {
      statusCode: response.status,
      body: JSON.stringify({ error: "Upstream RSS fetch failed" })
    };
  }
  const xml = await response.text();
  const videoIdMatch = xml.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
  const titleMatch = xml.match(/<title>([^<]+)<\/title>/g)?.[1];
  const videoId = videoIdMatch?.[1];
  const title = titleMatch?.replace(/<\/?title>/g, "");
  if (!videoId) {
    return { statusCode: 404, body: JSON.stringify({ error: "No videos found" }) };
  }
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "max-age=3600" },
    body: JSON.stringify({ videoId, title, channelId })
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
