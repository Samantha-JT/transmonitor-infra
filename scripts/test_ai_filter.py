#!/usr/bin/env python3
"""Test the trans-relevance AI filter directly against Bedrock."""
import json
import boto3

# System prompt — copied from _trans-ai-filter.ts
SYSTEM_PROMPT = """You are a relevance classifier for a transgender news dashboard that tracks BOTH supportive and hostile coverage of trans people.

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

Respond ONLY with a JSON array of booleans, no other text."""

TEST_TITLES = [
    "January Protests: Three Detainees Sentenced to a Total of 9 Years and 3 Months in Prison - Hrana",
    # Add controls — known-relevant and known-irrelevant
    "Transgender Jurupa Valley senior AB Hernandez wins state track medals amid muted protest",
    "JK Rowling criticises Scottish gender recognition reform",
    "Manchester United sign new midfielder in £40m deal",
    "EHRC guidance on single-sex spaces sparks legal challenge",
]

def main() -> None:
    client = boto3.client("bedrock-runtime", region_name="eu-west-1")
    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 256,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": json.dumps(TEST_TITLES)}],
    }
    resp = client.invoke_model(
        modelId="eu.anthropic.claude-haiku-4-5-20251001-v1:0",
        contentType="application/json",
        accept="application/json",
        body=json.dumps(body),
    )
    payload = json.loads(resp["body"].read())
    text = payload["content"][0]["text"].strip()
    print("Raw response:\n", text, "\n")

    # Parse and pretty-print
    text = text.removeprefix("```json").removesuffix("```").strip()
    try:
        verdicts = json.loads(text)
        print(f"{'Title':80}  Verdict")
        print("-" * 95)
        for title, verdict in zip(TEST_TITLES, verdicts):
            t = (title[:75] + "…") if len(title) > 76 else title
            print(f"{t:80}  {verdict}")
    except json.JSONDecodeError as e:
        print(f"Failed to parse: {e}")


if __name__ == "__main__":
    main()
