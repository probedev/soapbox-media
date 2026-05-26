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

/** A substantive political topic discussed that is NOT in the taxonomy —
 *  feedstock for emerging-issue discovery. */
export interface OffTaxonomyTopic {
  topic: string;
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
  /** Off-taxonomy political topics for emerging-issue discovery. */
  offTopics: OffTaxonomyTopic[];
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
6. If there are NO substantive mentions of ANY taxonomy issue, use an empty "mentions" array.

EMERGING-ISSUE DISCOVERY — separately, list any SUBSTANTIVE POLITICAL topic
discussed that is NOT covered by the taxonomy above (a specific bill, event,
policy, scandal, or controversy that maps to none of the issues). Give each a
short, specific label (3–6 words, e.g. "Trump anti-weaponization fund" — not a
vague word like "politics") plus a supporting quote. EXCLUDE anything
non-political (sports, celebrity, ads, market chatter) and anything already
covered by a taxonomy issue above. If none, use an empty "off_taxonomy" array.

OUTPUT FORMAT — return ONLY a JSON object with exactly this shape. No prose, no
markdown code fences, no commentary:
{
  "mentions": [
    {"issue_slug": "immigration", "supporting_quote": "We need to seal the southern border completely."}
  ],
  "off_taxonomy": [
    {"topic": "Trump anti-weaponization fund", "supporting_quote": "The new fund to claw back what they call weaponized prosecutions..."}
  ]
}`;
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
  // Tolerate both the current object shape {mentions, off_taxonomy} and a bare
  // array (legacy / model returning just mentions).
  const parsed = extractJson<unknown>(rawText);
  const obj: { mentions?: unknown; off_taxonomy?: unknown } = Array.isArray(parsed)
    ? { mentions: parsed, off_taxonomy: [] }
    : (parsed as any) || {};

  const rawMentions = Array.isArray(obj.mentions) ? obj.mentions : [];
  const mentions = (rawMentions as any[]).filter(
    (m): m is ClassificationMention =>
      typeof m?.issue_slug === "string" &&
      typeof m?.supporting_quote === "string" &&
      validSlugs.has(m.issue_slug) &&
      m.supporting_quote.length > 0,
  );

  const rawOff = Array.isArray(obj.off_taxonomy) ? obj.off_taxonomy : [];
  const offTopics: OffTaxonomyTopic[] = (rawOff as any[])
    .filter((o) => typeof o?.topic === "string" && o.topic.trim().length > 0)
    .map((o) => ({
      topic: String(o.topic).slice(0, 120),
      supporting_quote:
        typeof o?.supporting_quote === "string" ? o.supporting_quote.slice(0, 600) : "",
    }));

  return {
    mentions,
    offTopics,
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
    rawText,
  };
}
