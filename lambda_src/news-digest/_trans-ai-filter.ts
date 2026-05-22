const SYSTEM_PROMPT = `You are a news relevance classifier for a transgender news dashboard. Given a list of headlines, determine which are relevant to trans/nonbinary people, trans rights, or gender identity. Respond with ONLY a JSON array of booleans.`;
export async function aiFilterTransRelevant(items: Array<{ title?: string }>): Promise<boolean[]> {
  if (items.length === 0) return [];
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return items.map(() => true);
  try {
    const titles = items.map(i => i.title ?? '');
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama-3.1-8b-instant', temperature: 0, max_tokens: 256, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify(titles) }] }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return items.map(() => true);
    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim() ?? '';
    const parsed = JSON.parse(content) as unknown;
    if (Array.isArray(parsed)) return parsed.map(Boolean);
  } catch {}
  return items.map(() => true);
}