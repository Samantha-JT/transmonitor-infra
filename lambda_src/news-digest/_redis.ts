import { createClient } from 'redis';
var client: any = null;
async function getClient() {
  if (client && client.isOpen) return client;
  client = createClient({
    url: process.env.REDIS_URL,
    socket: { tls: true }
  });
  client.on('error', (err: any) => console.error('Redis error:', err));
  await client.connect();
  return client;
}
export async function cachedFetchJson<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T | null>): Promise<T | null> {
  try { const redis = await getClient(); const cached = await redis.get(key); if (cached) return JSON.parse(cached) as T; } catch {}
  const fresh = await fetcher();
  if (fresh !== null) { try { const redis = await getClient(); await redis.set(key, JSON.stringify(fresh), { EX: ttlSeconds }); } catch {} }
  return fresh;
}
export async function getCachedJsonBatch(keys: string[]): Promise<Map<string, unknown>> {
  const map = new Map<string, unknown>();
  if (keys.length === 0) return map;
  try { const redis = await getClient(); const values = await redis.mGet(keys); for (let i = 0; i < keys.length; i++) { const v = values[i]; if (v) map.set(keys[i]!, JSON.parse(v)); } } catch {}
  return map;
}
export async function runRedisPipeline(commands: Array<Array<string | number>>, _readonly = false): Promise<Array<{ result: unknown }>> {
  try {
    const redis = await getClient();
    const pipeline = redis.multi();
    for (const cmd of commands) { const [op, ...args] = cmd as [string, ...Array<string | number>]; (pipeline as any)[op.toLowerCase()](...args); }
    const results = await pipeline.exec();
    return (results ?? []).map(r => ({ result: r }));
  } catch { return commands.map(() => ({ result: null })); }
}