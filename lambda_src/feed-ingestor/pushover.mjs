const PUSHOVER_API = "https://api.pushover.net/1/messages.json";

export async function pushover({ token, user, title, message, priority = 0 }) {
  if (!token || !user) return;
  try {
    const res = await fetch(PUSHOVER_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, user, title, message, priority, html: 1 }),
    });
    if (!res.ok) console.error("Pushover error:", await res.text());
  } catch (err) {
    console.error("Pushover fetch failed:", err);
  }
}
