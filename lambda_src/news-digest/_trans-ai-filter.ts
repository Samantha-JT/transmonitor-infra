import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const SYSTEM_PROMPT = `You are a relevance classifier for a transgender news dashboard that tracks BOTH supportive and hostile coverage of trans people.

Given a JSON array of headlines, return a JSON array of booleans — true if the article relates to trans people, trans rights, gender identity policy, or trans healthcare.

CRITICAL: Anti-trans content often does NOT use the word "trans" or "transgender" explicitly. Mark TRUE for headlines using hostile framing or dog-whistle terms that target trans people, including:

- "single-sex spaces", "sex-segregated spaces", "women-only spaces"
- "biological male/female", "biological woman/man", "adult human female/male"
- "sex-based rights", "protecting women and girls" (in policy/sport/spaces context)
- "gender ideology", "gender-critical", "TERF"
- "women's sport", "female athletes" (when in fairness/inclusion debate context)
- "women's prison", "female ward", "women's refuge" (in policy debate context)
- "changing rooms", "toilets" (when discussing access/policy)
- "gender questioning", "trans kids", "social contagion"
- Coverage of figures like JK Rowling, Helen Joyce, Kathleen Stock, Maya Forstater on gender issues
- EHRC guidance, Equality Act updates, Cass Review coverage
- Court cases involving gender recognition, trans healthcare, or sex-based rights
- "Conversion therapy" debates that involve gender identity

Mark FALSE only for:
- Stories where a trans person is incidentally mentioned but the story is about something else entirely (e.g. a trans person caught up in an unrelated traffic accident)
- Pure women's rights stories with no trans-related framing or implications
- Unrelated topics that happen to use words like "gender" in non-trans contexts (e.g. gender pay gap statistics with no trans angle)

When in doubt, mark TRUE. False positives are recoverable; missing hostile coverage of trans people is the bigger failure.

Respond ONLY with a JSON array of booleans, no other text.`;

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