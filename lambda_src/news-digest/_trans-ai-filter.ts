import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const SYSTEM_PROMPT = `You are a relevance classifier for a transgender news dashboard. Given a JSON array of headlines, return a JSON array of booleans — true if the article's PRIMARY subject is transgender/nonbinary people, trans rights, gender identity policy, or trans healthcare. Return false if trans identity is merely mentioned incidentally (e.g. a trans athlete in a general sports story, or a trans person in a general crime story where their identity is not the focus). Respond ONLY with a JSON array of booleans, no other text.`;

export async function aiFilterTransRelevant(items: Array<{ title?: string }>): Promise<boolean[]> {
  if (items.length === 0) return [];

  const modelId = process.env.AWS_BEDROCK_MODEL_ID ?? 'eu.anthropic.claude-haiku-4-5-20251001-v1:0';
  const region = process.env.AWS_BEDROCK_REGION ?? 'eu-west-1';

  try {
    const bedrock = new BedrockRuntimeClient({ region });
    const titles = items.map(i => i.title ?? '');

    const result = await Promise.race([
      bedrock.send(new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 256,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: JSON.stringify(titles) }],
        }),
      })),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('bedrock_timeout')), 8_000)),
    ]);

    const raw = JSON.parse(new TextDecoder().decode((result as any).body));
    const text = (raw.content?.[0]?.text ?? '').trim()
      .replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return parsed.map(Boolean);
  } catch (err) {
    console.warn('[ai-filter] bedrock failed, dropping keyword-failed items:', (err as Error).message);
  }

  // Fail closed — don't pass items through if AI is unavailable
  return items.map(() => false);
}