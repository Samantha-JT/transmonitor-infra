/**
 * TransMonitor Security Scoring Lambda
 * Called async by the Cloudflare security worker to score ambiguous requests.
 * Uses Bedrock Claude Haiku — reuses existing IAM role and model config.
 *
 * POST /security/score
 * Body: { ip, country, asn, asnOrg, ua, path, rateCount, cfThreat, reasons }
 * Response: { score: 0-100, reasoning: string }
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_BEDROCK_REGION ?? "eu-west-1",
});

const MODEL_ID = process.env.AWS_BEDROCK_MODEL_ID ?? "eu.anthropic.claude-haiku-4-5-20251001-v1:0";

export const handler = async (event) => {
  // API Gateway passes body as string
  let body;
  try {
    body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
  } catch {
    return response(400, { error: "Invalid JSON body" });
  }

  const {
    ip       = "unknown",
    country  = "XX",
    asn      = null,
    asnOrg   = "",
    ua       = "",
    path     = "/",
    rateCount = 0,
    cfThreat  = 0,
    reasons  = [],
  } = body ?? {};

  const prompt = `You are a web security analyst. Analyse this HTTP request to a trans rights news website and return a JSON risk score.

Request fingerprint:
- IP: ${ip}
- Country: ${country}
- ASN: ${asn} (${asnOrg})
- User-Agent: ${ua}
- Path: ${path}
- Requests in last 5 min from this IP: ${rateCount}
- Cloudflare threat score: ${cfThreat}/100
- Initial risk flags: ${reasons.join(", ") || "none"}

Score 0 (benign) to 100 (certain attack). Consider:
- Is this path ever legitimate for a trans rights news aggregator?
- Does the UA/ASN suggest automation or a scanning tool?
- Is the request volume consistent with human browsing?

Respond ONLY with valid JSON, no markdown: {"score": <number>, "reasoning": "<one sentence max 100 chars>"}`;

  try {
    const cmd = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 120,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const res  = await bedrock.send(cmd);
    const text = JSON.parse(Buffer.from(res.body).toString());
    const content = text.content?.[0]?.text ?? "{}";
    const parsed  = JSON.parse(content.trim());

    return response(200, {
      score:     Math.min(100, Math.max(0, Number(parsed.score ?? 0))),
      reasoning: String(parsed.reasoning ?? "No reasoning").slice(0, 100),
    });
  } catch (err) {
    console.error("Bedrock scoring error:", err);
    return response(200, { score: 0, reasoning: "Scoring failed — defaulting safe" });
  }
};

const response = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
