import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

let _client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: env.anthropicApiKey });
  }
  return _client;
}

/**
 * Model selection by task:
 * - Sonnet 4.6 for classification (nuanced multi-issue extraction from long transcripts)
 * - Haiku 4.5 for scoring (structured sentiment/intensity from short quotes - fast + cheap)
 */
export const MODEL_CLASSIFY = "claude-sonnet-4-6";
export const MODEL_SCORE = "claude-haiku-4-5-20251001";
// Haiku for short one-off generations like the admin channel-rationale draft -
// fast, cheap, and a single sentence doesn't need Sonnet.
export const MODEL_RATIONALE = "claude-haiku-4-5-20251001";

/**
 * Extract a JSON array or object from a Claude text response.
 * Handles markdown code fences and surrounding prose, returns null if nothing parses.
 */
/**
 * Strip non-standard tokens that LLMs frequently emit which `JSON.parse`
 * rejects. Currently:
 *   - Leading `+` on positive numbers (e.g. `+4.2` → `4.2`). Haiku in
 *     particular has been observed adding these to score values; the
 *     JSON spec only allows a leading `-`, so `JSON.parse` throws.
 * Targets only `+` immediately after `:` `,` or `[` (with optional
 *     whitespace) and immediately before a digit - i.e. JSON value
 *     positions. Won't touch `+` inside string literals.
 */
function normalizeLlmJson(raw: string): string {
  return raw.replace(/([:,\[]\s*)\+(\d)/g, "$1$2");
}

export function extractJson<T>(text: string): T | null {
  // Try fenced JSON first
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidates: string[] = [];
  if (fenced) candidates.push(fenced[1]);
  // Bare array or object - match the outermost braces/brackets
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) candidates.push(arrayMatch[0]);
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) candidates.push(objMatch[0]);

  for (const c of candidates) {
    try {
      return JSON.parse(normalizeLlmJson(c)) as T;
    } catch {
      // try next
    }
  }
  return null;
}
