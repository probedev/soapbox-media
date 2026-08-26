/**
 * Ad-segment confirmation: one short Haiku call per candidate segment from
 * the regex layer (src/lib/ads.ts). Settles the verdict (paid third-party
 * sponsor read vs the show's own self-promotion vs not an ad) and extracts
 * the brand + domain, fixing transcription mangles from context (the probe's
 * favorite: "hymns.com" for Hims). ~900 input tokens per call at Haiku
 * prices, so the recurring spend is a few dollars a month; the caps in
 * pipeline.ts are the real guard.
 */
import { getAnthropicClient, MODEL_SCORE, extractJson } from "@/lib/anthropic";

/** Bump when the prompt changes materially (stored on each confirmed row). */
export const AD_CONFIRM_PROMPT_VERSION = "v2";

export type AdVerdict = "ad" | "self_promo" | "not_ad";

export interface AdConfirmInput {
  excerpt: string;
  channelName: string;
}

export interface AdConfirmResult {
  kind: AdVerdict;
  advertiser: string | null;
  domain: string | null;
  inputTokens?: number;
  outputTokens?: number;
}

function buildAdConfirmPrompt(input: AdConfirmInput): string {
  return `You are auditing a podcast/YouTube transcript excerpt for a SPONSOR READ (an inline advertisement).

EXCERPT - from "${input.channelName}" (auto-transcribed; may be mangled or cut off mid-sentence):
"${input.excerpt.slice(0, 2400)}"

Classify the excerpt as exactly one of:
- "ad": a paid sponsor read for a THIRD-PARTY brand, product, or service (a sponsor intro, promo code, discount offer, or sponsor URL read by the host or a produced voice).
- "self_promo": promotion of the show's OWN offerings or network: memberships, Substack/Patreon, merch, live shows or tickets, the host's own books/products, other shows from the same host or network, or asks to like/subscribe/follow.
- "not_ad": everything else - organic discussion, news content, or a brand mentioned editorially.

If (and only if) it is an "ad", also extract:
- advertiser: the brand name as the company itself writes it. Fix obvious transcription errors from context (a brand spelled out letter by letter, or misheard: "hymns" in a telehealth ad is "Hims"). null if you genuinely cannot tell.
- domain: the promoted web domain if one is stated, normalized ("quince dot com slash show" is "quince.com"). null if none.

If the excerpt contains MORE THAN ONE distinct sponsor read (a back-to-back ad break), return the single most prominent one - the brand whose pitch dominates the excerpt. Never return arrays or multiple objects.

Return ONLY one JSON object with scalar values, no prose, no code fences. Examples:
{"kind": "ad", "advertiser": "Quince", "domain": "quince.com"}
{"kind": "self_promo", "advertiser": null, "domain": null}
{"kind": "not_ad", "advertiser": null, "domain": null}`;
}

/**
 * Parse the model's verdict, tolerating the shapes it actually emits on
 * multi-ad excerpts despite the prompt: array values for advertiser/domain
 * (take the first, matching the "most prominent" instruction) and several
 * JSON objects in one fence (take the first complete object). Pure and
 * exported for unit tests. Returns null when nothing usable parses.
 */
export function parseAdVerdict(rawText: string): Omit<AdConfirmResult, "inputTokens" | "outputTokens"> | null {
  type Loose = { kind?: string; advertiser?: unknown; domain?: unknown };
  let parsed = extractJson<Loose>(rawText);
  if (!parsed || typeof parsed.kind !== "string") {
    // Multiple concatenated objects defeat extractJson's greedy brace match;
    // fall back to the first flat {...} block.
    const first = rawText.match(/\{[^{}]*\}/);
    parsed = first ? extractJson<Loose>(first[0]) : null;
  }
  if (!parsed || !["ad", "self_promo", "not_ad"].includes(parsed.kind as string)) return null;
  const scalar = (v: unknown): string | null => {
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === "string" && s.trim() ? s.trim() : null;
  };
  return {
    kind: parsed.kind as AdVerdict,
    advertiser: scalar(parsed.advertiser),
    domain: scalar(parsed.domain),
  };
}

export async function confirmAdSegment(input: AdConfirmInput): Promise<AdConfirmResult> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: MODEL_SCORE,
    max_tokens: 300,
    messages: [{ role: "user", content: buildAdConfirmPrompt(input) }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const rawText = textBlock && textBlock.type === "text" ? textBlock.text : "";
  const parsed = parseAdVerdict(rawText);
  if (!parsed) {
    throw new Error(`Could not parse ad verdict from response: ${rawText.slice(0, 200)}`);
  }
  return {
    ...parsed,
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
  };
}
