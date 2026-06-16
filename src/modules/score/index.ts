/**
 * Score module - assign sentiment + intensity to a single classification.
 *
 * Uses Claude Haiku 4.5 for cost efficiency. Output is two numbers per quote:
 *   - sentiment: −5 .. +5  (negative = left-aligned, positive = right-aligned)
 *   - intensity:  1 ..  5  (1 = passing remark, 5 = passionate central argument)
 */
import { getAnthropicClient, MODEL_SCORE, extractJson } from "@/lib/anthropic";

export interface ScoreInput {
  quote: string;
  channelName: string;
  politicalLean: "L" | "M" | "R";
  issueName: string;
  issueDefinition: string;
  leftPosition: string;
  rightPosition: string;
}

export interface ScoreResult {
  sentiment: number;
  intensity: number;
  inputTokens?: number;
  outputTokens?: number;
  rawText: string;
}

/** Max output tokens for the score call (two numbers + a hair of slack). */
export const SCORE_MAX_TOKENS = 200;

/**
 * Prompt version - BUMP whenever buildPrompt below changes. Scoring changes must
 * be validated against the gold set before shipping (see CLAUDE.md). v1 = first
 * labeled version (2026-06-10); the prompt predates the label. Surfaced read-only
 * at /admin/prompts.
 */
export const SCORE_PROMPT_VERSION = "v1";

function buildPrompt(input: ScoreInput): string {
  return `You are rating a single political statement for (a) its alignment with the left vs. right position on a defined issue, and (b) the intensity with which the speaker expresses the view.

ISSUE: ${input.issueName}
ISSUE DEFINITION: ${input.issueDefinition}

THE LEFT-LEANING POSITION on this issue is: ${input.leftPosition}
THE RIGHT-LEANING POSITION on this issue is: ${input.rightPosition}

QUOTE - spoken on ${input.channelName} (editorial lean: ${input.politicalLean}):
"${input.quote}"

SCORING DEFINITIONS:

sentiment - a number from -5.0 to +5.0:
  -5.0 = strongly aligned with the LEFT-LEANING position
  -2.5 = mildly aligned with the LEFT-LEANING position
   0.0 = neutral, balanced, descriptive, or unclear
  +2.5 = mildly aligned with the RIGHT-LEANING position
  +5.0 = strongly aligned with the RIGHT-LEANING position

intensity - a number from 1 to 5:
  1 = passing remark, casual mention
  2 = clear but brief statement
  3 = deliberate well-formed statement of view
  4 = strongly emphasized, repeated, or central to surrounding discussion
  5 = passionate, extensive, primary argument of the segment

IMPORTANT:
- Score the statement on its own merits, NOT by the channel's overall lean.
- A left-leaning channel can have a centrist or right-leaning quote, and vice versa.
- Use the LEFT/RIGHT positions defined above as your reference, not US-political-stereotypes.

Return ONLY a JSON object with two numeric fields. No prose, no code fences,
no leading "+" on positive numbers (write 4.2 not +4.2 - JSON does not allow
a leading "+").

Examples:
{"sentiment": -3.2, "intensity": 4}
{"sentiment": 2.7, "intensity": 5}
{"sentiment": 0, "intensity": 1}`;
}

/**
 * The score prompt rendered with labeled placeholders for its dynamic slots, for
 * the read-only /admin/prompts view. Built from the real buildPrompt so the
 * displayed template can never drift from what actually runs.
 */
export function scorePromptPreview(): string {
  return buildPrompt({
    quote: "{{QUOTE}}",
    channelName: "{{CHANNEL_NAME}}",
    politicalLean: "{{LEAN}}" as ScoreInput["politicalLean"],
    issueName: "{{Issue Name}}",
    issueDefinition: "{{issue definition}}",
    leftPosition: "{{left-leaning position}}",
    rightPosition: "{{right-leaning position}}",
  });
}

export async function scoreClassification(input: ScoreInput): Promise<ScoreResult> {
  const client = getAnthropicClient();
  const prompt = buildPrompt(input);

  const response = await client.messages.create({
    model: MODEL_SCORE,
    max_tokens: SCORE_MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const rawText = textBlock && textBlock.type === "text" ? textBlock.text : "";

  const parsed = extractJson<{ sentiment: number; intensity: number }>(rawText);
  if (!parsed || typeof parsed.sentiment !== "number" || typeof parsed.intensity !== "number") {
    throw new Error(`Could not parse score from response: ${rawText.slice(0, 200)}`);
  }

  // Clamp to valid ranges (model occasionally drifts a hair outside)
  const sentiment = Math.max(-5, Math.min(5, parsed.sentiment));
  const intensity = Math.max(1, Math.min(5, parsed.intensity));

  return {
    sentiment,
    intensity,
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
    rawText,
  };
}

// ─── Emerging-topic favorability ──────────────────────────────────────────
//
// A SEPARATE axis from the L/R sentiment above. Emerging topics (off-taxonomy
// events on /emerging) have no left/right poles to score against - "the left
// position on the UFC-at-the-White-House event" is fiction. What IS meaningful
// is how FAVORABLE vs. critical the conversation is toward the subject itself.
// So this scorer rates favorability, not ideological alignment, and the result
// is presented with its own gauge (never the red/blue L/R needle). Reuses the
// same Haiku model + parse/clamp machinery as scoreClassification.

export interface EmergingScoreInput {
  quote: string;
  channelName: string;
  politicalLean: "L" | "M" | "R";
  /** The emerging subject this quote is about (the topic's own stable label). */
  subject: string;
  /** Short context for the subject (the candidate summary), for disambiguation. */
  subjectContext?: string;
}

export interface EmergingScoreResult {
  /** -5 (hostile/scathing) .. 0 (neutral/descriptive) .. +5 (celebratory). */
  favorability: number;
  intensity: number;
  inputTokens?: number;
  outputTokens?: number;
  rawText: string;
}

/**
 * Prompt version - BUMP whenever buildEmergingPrompt changes. This is a new axis
 * the L/R gold set does not cover; v1 ships on a manual spot-check, with a
 * dedicated favorability gold set as the gate before it becomes load-bearing
 * (i.e. before MCP exposes it). Surfaced read-only at /admin/prompts.
 */
export const EMERGING_SCORE_PROMPT_VERSION = "v1";

function buildEmergingPrompt(input: EmergingScoreInput): string {
  const context = input.subjectContext
    ? `\nSUBJECT CONTEXT: ${input.subjectContext}`
    : "";
  return `You are rating how FAVORABLE a single political statement is toward a specific emerging subject, and the intensity with which the speaker expresses it. This is NOT a left/right rating - judge only how positive vs. negative the speaker is about the subject.

SUBJECT: ${input.subject}${context}

QUOTE - spoken on ${input.channelName} (editorial lean: ${input.politicalLean}):
"${input.quote}"

SCORING DEFINITIONS:

favorability - a number from -5.0 to +5.0, the speaker's stance TOWARD the subject:
  -5.0 = scathing, hostile, condemns it outright
  -2.5 = critical, disapproving
   0.0 = neutral, balanced, or purely descriptive (e.g. straight news reporting)
  +2.5 = approving, supportive
  +5.0 = celebratory, glowing, champions it

intensity - a number from 1 to 5:
  1 = passing remark, casual mention
  2 = clear but brief statement
  3 = deliberate well-formed statement of view
  4 = strongly emphasized, repeated, or central to surrounding discussion
  5 = passionate, extensive, primary argument of the segment

IMPORTANT:
- Rate favorability toward THE SUBJECT, on the statement's own merits.
- Do NOT use the channel's lean - a left-leaning channel can be favorable and vice versa.
- Neutral, factual, or descriptive reporting scores near 0, regardless of the subject.

Return ONLY a JSON object with two numeric fields. No prose, no code fences,
no leading "+" on positive numbers (write 4.2 not +4.2 - JSON does not allow
a leading "+").

Examples:
{"favorability": -3.2, "intensity": 4}
{"favorability": 2.7, "intensity": 5}
{"favorability": 0, "intensity": 1}`;
}

/**
 * The emerging-favorability prompt rendered with labeled placeholders, for the
 * read-only /admin/prompts view. Built from the real builder so it can't drift.
 */
export function scoreEmergingPromptPreview(): string {
  return buildEmergingPrompt({
    quote: "{{QUOTE}}",
    channelName: "{{CHANNEL_NAME}}",
    politicalLean: "{{LEAN}}" as EmergingScoreInput["politicalLean"],
    subject: "{{SUBJECT}}",
    subjectContext: "{{subject context}}",
  });
}

export async function scoreEmergingMention(
  input: EmergingScoreInput,
): Promise<EmergingScoreResult> {
  const client = getAnthropicClient();
  const prompt = buildEmergingPrompt(input);

  const response = await client.messages.create({
    model: MODEL_SCORE,
    max_tokens: SCORE_MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const rawText = textBlock && textBlock.type === "text" ? textBlock.text : "";

  const parsed = extractJson<{ favorability: number; intensity: number }>(rawText);
  if (!parsed || typeof parsed.favorability !== "number" || typeof parsed.intensity !== "number") {
    throw new Error(`Could not parse emerging score from response: ${rawText.slice(0, 200)}`);
  }

  // Clamp to valid ranges (model occasionally drifts a hair outside).
  const favorability = Math.max(-5, Math.min(5, parsed.favorability));
  const intensity = Math.max(1, Math.min(5, parsed.intensity));

  return {
    favorability,
    intensity,
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
    rawText,
  };
}
