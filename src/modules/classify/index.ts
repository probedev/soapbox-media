/**
 * Classify module — turn a transcript into a list of (issue, supporting_quote) mentions.
 *
 * Uses Claude Sonnet 4.6 with a structured prompt. Returns only substantive
 * mentions — passing references, ad reads, and lists are explicitly excluded.
 */
import { getAnthropicClient, MODEL_CLASSIFY, extractJson } from "@/lib/anthropic";

export interface IssueDef {
  slug: string;
  name: string;
  definition: string;
}

export interface ClassificationMention {
  issue_slug: string;
  supporting_quote: string;
}

export interface ClassifyInput {
  transcript: string;
  channelName: string;
  politicalLean: "L" | "M" | "R";
  episodeTitle: string;
  publishedAt: string;
  issues: IssueDef[];
}

export interface ClassifyResult {
  mentions: ClassificationMention[];
  inputTokens?: number;
  outputTokens?: number;
  /** Raw response text from the model (useful for debugging) */
  rawText: string;
}

function buildPrompt(input: ClassifyInput): string {
  const issuesList = input.issues
    .map((i) => `- ${i.slug}: ${i.name} — ${i.definition}`)
    .join("\n");

  return `You are analyzing a transcript from a political show on YouTube or a podcast. Your task is to identify SUBSTANTIVE discussions of specific political issues from a defined taxonomy.

ISSUE TAXONOMY:
${issuesList}

WHAT COUNTS AS "SUBSTANTIVE":
- The speaker expresses a clear view or opinion on the issue
- They analyze a recent event tied to the issue
- They engage with policy implications or debate the issue
- The discussion is meaningful (more than a sentence in passing)

WHAT DOES NOT COUNT:
- Brief mentions in lists or transitions
- Throwaway references without engagement
- Sponsored content / ad reads / promotional segments
- Pure entertainment, stock-market chat, or off-topic banter

EPISODE METADATA:
Channel: ${input.channelName} (editorial lean: ${input.politicalLean})
Title: ${input.episodeTitle}
Published: ${input.publishedAt}

TRANSCRIPT (transcript may include some imperfect auto-captioned text):
${input.transcript}

INSTRUCTIONS:
1. Identify each DISTINCT substantive discussion of any issue from the taxonomy above.
2. For each one, return:
   - issue_slug: must exactly match one slug from the taxonomy
   - supporting_quote: a direct verbatim quote from the transcript, 80-300 characters, that captures the discussion
3. Multiple distinct mentions of the SAME issue are fine — return each as a separate object.
4. If a passage discusses multiple issues, return one object per issue with a quote that focuses on each.
5. Prioritize quality over quantity. Better to return 3 clear, substantiated mentions than 15 weak ones.
6. If there are NO substantive mentions of ANY taxonomy issue, return an empty array: []

OUTPUT FORMAT — return ONLY a JSON array. No prose, no markdown code fences, no commentary.

Example response shape:
[
  {"issue_slug": "immigration", "supporting_quote": "We need to seal the southern border completely — every other policy depends on this."},
  {"issue_slug": "transgender", "supporting_quote": "Parents have a right to know what's being taught about gender in their kids' schools."}
]`;
}

export async function classifyTranscript(input: ClassifyInput): Promise<ClassifyResult> {
  const client = getAnthropicClient();
  const prompt = buildPrompt(input);

  const response = await client.messages.create({
    model: MODEL_CLASSIFY,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const rawText = textBlock && textBlock.type === "text" ? textBlock.text : "";

  const validSlugs = new Set(input.issues.map((i) => i.slug));
  const parsed = extractJson<ClassificationMention[]>(rawText);
  const mentions = Array.isArray(parsed)
    ? parsed.filter(
        (m): m is ClassificationMention =>
          typeof m?.issue_slug === "string" &&
          typeof m?.supporting_quote === "string" &&
          validSlugs.has(m.issue_slug) &&
          m.supporting_quote.length > 0,
      )
    : [];

  return {
    mentions,
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
    rawText,
  };
}
