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

// youtube-latest/index.mjs
var index_exports = {};
__export(index_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(index_exports);
var CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
function parseLatestVideo(xml) {
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const e = m[1];
    const link = e.match(/<link\s+rel="alternate"\s+href="([^"]+)"/);
    if (link?.[1]?.includes("/shorts/")) continue;
    const vid = e.match(/<yt:videoId>([A-Za-z0-9_-]{11})<\/yt:videoId>/);
    const title = e.match(/<title>([^<]+)<\/title>/);
    const pub = e.match(/<published>([^<]+)<\/published>/);
    if (vid?.[1]) return { videoId: vid[1], title: title?.[1] || "", published: pub?.[1] || "" };
  }
  return null;
}
var handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const channelId = event.queryStringParameters?.channelId;
  const channel = event.queryStringParameters?.channel;
  if (!channelId && !channel) return { statusCode: 400, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Missing channelId or channel" }) };
  let id = channelId;
  if (!id && channel) {
    try {
      const h = channel.startsWith("@") ? channel : "@" + channel;
      const r = await fetch("https://www.youtube.com/" + h, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(8e3) });
      if (r.ok) {
        const html = await r.text();
        const mx = html.match(/"externalId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"/) || html.match(/channel\/(UC[A-Za-z0-9_-]{22})"/);
        if (mx?.[1]) id = mx[1];
      }
    } catch {
    }
    if (!id) return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ videoId: null, channelExists: false, error: "Channel not found" }) };
  }
  try {
    const fr = await fetch("https://www.youtube.com/feeds/videos.xml?channel_id=" + id, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(1e4) });
    if (!fr.ok) return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ videoId: null, channelExists: true, channelId: id, error: "RSS unavailable" }) };
    const xml = await fr.text();
    const latest = parseLatestVideo(xml);
    if (!latest) return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ videoId: null, channelExists: true, channelId: id, entryCount: 0 }) };
    const cn = xml.match(/<feed[^>]*>[\s\S]*?<title>([^<]+)<\/title>/)?.[1] || "";
    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=1800, s-maxage=1800" },
      body: JSON.stringify({ videoId: latest.videoId, title: latest.title, published: latest.published, isLive: false, channelExists: true, channelId: id, channelName: cn })
    };
  } catch (e) {
    return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ videoId: null, error: e.message }) };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
