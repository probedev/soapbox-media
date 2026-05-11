/**
 * Score module — assign sentiment + intensity to a single classification.
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

function buildPrompt(input: ScoreInput): string {
  return `You are rating a single political statement for (a) its alignment with the left vs. right position on a defined issue, and (b) the intensity with which the speaker expresses the view.

ISSUE: ${input.issueName}
ISSUE DEFINITION: ${input.issueDefinition}

THE LEFT-LEANING POSITION on this issue is: ${input.leftPosition}
THE RIGHT-LEANING POSITION on this issue is: ${input.rightPosition}

QUOTE — spoken on ${input.channelName} (editorial lean: ${input.politicalLean}):
"${input.quote}"

SCORING DEFINITIONS:

sentiment — a number from -5.0 to +5.0:
  -5.0 = strongly aligned with the LEFT-LEANING position
  -2.5 = mildly aligned with the LEFT-LEANING position
   0.0 = neutral, balanced, descriptive, or unclear
  +2.5 = mildly aligned with the RIGHT-LEANING position
  +5.0 = strongly aligned with the RIGHT-LEANING position

intensity — a number from 1 to 5:
  1 = passing remark, casual mention
  2 = clear but brief statement
  3 = deliberate well-formed statement of view
  4 = strongly emphasized, repeated, or central to surrounding discussion
  5 = passionate, extensive, primary argument of the segment

IMPORTANT:
- Score the statement on its own merits, NOT by the channel's overall lean.
- A left-leaning channel can have a centrist or right-leaning quote, and vice versa.
- Use the LEFT/RIGHT positions defined above as your reference, not US-political-stereotypes.

Return ONLY a JSON object with two numeric fields. No prose, no code fences.

Example: {"sentiment": -3.2, "intensity": 4}`;
}

export async function scoreClassification(input: ScoreInput): Promise<ScoreResult> {
  const client = getAnthropicClient();
  const prompt = buildPrompt(input);

  const response = await client.messages.create({
    model: MODEL_SCORE,
    max_tokens: 200,
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
