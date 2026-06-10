/**
 * EXPERIMENTAL v1.2 stance stage - a SEPARATE annotation pass over a FROZEN
 * classify mention. Takes one (issue, quote) + a transcript context window and
 * labels the SHOW'S relationship to the position in the quote. NOT wired into
 * production; used by scripts/eval-stance-impact.ts.
 *
 * Why a separate stage (vs the v1.1 in-classify experiment): v1.1 changed
 * extraction (it dropped below the v1-vs-v1 noise floor) AND over-fired - ~50%
 * of its "rebuts" calls were actually the host's OWN critical view of an
 * opponent. This stage freezes extraction (runs over v1's output) and sharpens
 * the definition: the only decision that matters for scoring is whether the
 * quote is the show's OWN position or a position it OPPOSES (quoted/played by
 * someone else), plus a neutral-report bucket. The host criticizing an opponent
 * is explicitly "own". See [[prompt-versioning-and-attribution]].
 */
import { getAnthropicClient, MODEL_CLASSIFY, extractJson } from "@/lib/anthropic";

export const STANCE_STAGE_VERSION = "v1.2";
export type Attribution = "own" | "opposing" | "report";

export interface StanceInput {
  quote: string;
  context: string;
  issueName: string;
  channelName: string;
  politicalLean: "L" | "M" | "R";
}

export interface StanceResult {
  attribution: Attribution;
  confidence: number;
  reason: string;
  inputTokens?: number;
  outputTokens?: number;
}

function buildPrompt(i: StanceInput): string {
  return `A classifier pulled the QUOTE below from a US political show as a mention of "${i.issueName}". We score each quote for its left/right alignment on the issue - but a quote only reflects THE SHOW'S stance when the host is expressing their OWN position. Sometimes a host quotes, paraphrases, or plays a clip of the OTHER SIDE; scoring that at face value would invert the show's actual stance.

Decide the SHOW'S relationship to the position expressed in the quote:
- "own": the host/show expresses this as their OWN position on the issue. This INCLUDES the host's own criticism OF an opponent - that criticism is the host's own view, so it is "own". Score as-is.
- "opposing": the quote states a position the SHOW OPPOSES, voiced by someone else the host is quoting / paraphrasing / playing a clip of (an opponent, a politician, "the other side"). The show holds the OPPOSITE view, so scoring this at face value would be backwards.
- "report": a neutral factual statement (news read-out, description of events) that takes no side on the issue.

Be conservative - MOST quotes are "own" (the host stating their view, including critical views of opponents). Only choose "opposing" when the quote clearly voices a position the host is AGAINST, spoken by or attributed to someone else. The transcripts have no speaker labels; in YouTube captions ">>" marks a change of speaker.

ISSUE: ${i.issueName}
SHOW: ${i.channelName} (editorial lean ${i.politicalLean})
QUOTE: "${i.quote}"

CONTEXT (excerpt):
${i.context}

Return ONLY JSON: {"attribution": "own"|"opposing"|"report", "confidence": 0.0-1.0, "reason": "one short sentence"}`;
}

export async function classifyMentionStance(input: StanceInput): Promise<StanceResult> {
  const client = getAnthropicClient();
  const resp = await client.messages.create({
    model: MODEL_CLASSIFY, // Sonnet 4.6 - nuanced judgment over short context
    max_tokens: 220,
    messages: [{ role: "user", content: buildPrompt(input) }],
  });
  const tb = resp.content.find((b) => b.type === "text");
  const raw = tb && tb.type === "text" ? tb.text : "";
  const parsed = extractJson<any>(raw);
  const a = parsed?.attribution;
  const attribution: Attribution = a === "opposing" || a === "report" ? a : "own";
  return {
    attribution,
    confidence: typeof parsed?.confidence === "number" ? parsed.confidence : 0,
    reason: typeof parsed?.reason === "string" ? String(parsed.reason).slice(0, 240) : "",
    inputTokens: resp.usage?.input_tokens,
    outputTokens: resp.usage?.output_tokens,
  };
}
