// youtube-proxy/index.mjs
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
export {
  handler
};
