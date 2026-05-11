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
 * - Haiku 4.5 for scoring (structured sentiment/intensity from short quotes — fast + cheap)
 */
export const MODEL_CLASSIFY = "claude-sonnet-4-6";
export const MODEL_SCORE = "claude-haiku-4-5-20251001";

/**
 * Extract a JSON array or object from a Claude text response.
 * Handles markdown code fences and surrounding prose, returns null if nothing parses.
 */
export function extractJson<T>(text: string): T | null {
  // Try fenced JSON first
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidates: string[] = [];
  if (fenced) candidates.push(fenced[1]);
  // Bare array or object — match the outermost braces/brackets
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) candidates.push(arrayMatch[0]);
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) candidates.push(objMatch[0]);

  for (const c of candidates) {
    try {
      return JSON.parse(c) as T;
    } catch {
      // try next
    }
  }
  return null;
}
