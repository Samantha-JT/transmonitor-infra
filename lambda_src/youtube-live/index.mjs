const CORS_HEADERS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

export const handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS") return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  const channel = event.queryStringParameters?.channel;
  const videoIdParam = event.queryStringParameters?.videoId;
  if (!channel && !videoIdParam) return { statusCode: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Missing channel or videoId" }) };

  if (videoIdParam && /^[A-Za-z0-9_-]{11}$/.test(videoIdParam)) {
    try {
      const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoIdParam}&format=json`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(5000) });
      if (r.ok) { const d = await r.json(); return { statusCode: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "public, max-age=3600, s-maxage=3600" }, body: JSON.stringify({ channelName: d.author_name || null, title: d.title || null, videoId: videoIdParam, isLive: false }) }; }
    } catch {}
    return { statusCode: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ channelName: null, title: null, videoId: videoIdParam, isLive: false }) };
  }

  if (!channel) return { statusCode: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Missing channel" }) };

  try {
    const handle = channel.startsWith("@") ? channel : `@${channel}`;
    const response = await fetch(`https://www.youtube.com/${handle}/live`, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(10000) });
    if (!response.ok) return { statusCode: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ videoId: null, isLive: false, channelExists: false }) };
    const html = await response.text();
    const channelExists = html.includes('"channelId"') || html.includes("og:url");
    let channelName = null;
    const ownerMatch = html.match(/"ownerChannelName"\s*:\s*"([^"]+)"/);
    if (ownerMatch) channelName = ownerMatch[1];
    let videoId = null;
    const detailsIdx = html.indexOf('"videoDetails"');
    if (detailsIdx !== -1) {
      const block = html.substring(detailsIdx, detailsIdx + 5000);
      const vidMatch = block.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
      const liveMatch = block.match(/"isLive"\s*:\s*true/);
      if (vidMatch && liveMatch) videoId = vidMatch[1];
    }
    let hlsUrl = null;
    const hlsMatch = html.match(/"hlsManifestUrl"\s*:\s*"([^"]+)"/);
    if (hlsMatch && videoId) hlsUrl = hlsMatch[1].replace(/\\u0026/g, "&");
    return { statusCode: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "public, max-age=300, s-maxage=600" }, body: JSON.stringify({ videoId, isLive: videoId !== null, channelExists, channelName, hlsUrl }) };
  } catch (error) {
    return { statusCode: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ videoId: null, isLive: false, error: error.message }) };
  }
};
