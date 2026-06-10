/**
 * EXPERIMENTAL classify v1.1 - speaker-attribution prototype. NOT wired into the
 * production pipeline; used only by scripts/eval-attribution.ts to evaluate
 * adding a `stance` annotation to each mention against v1, BEFORE any schema or
 * scoring change.
 *
 * Minimal diff from v1's buildPrompt (src/modules/classify/index.ts): the
 * extraction instructions, taxonomy, "what counts", and metadata blocks are
 * byte-identical, so on easy cases the extracted (issue, quote) pairs should
 * match v1 and any drift is measurable noise. The ONLY addition is a per-mention
 * `stance` field (endorses | rebuts | reports) inferred from context - our
 * transcripts have no speaker labels (YouTube has anonymous ">>" turn markers on
 * ~79%, podcasts have none), so stance must be inferred. See the
 * prompt-versioning-and-attribution memory. BUMP the version on any change.
 */
import { getAnthropicClient, MODEL_CLASSIFY, extractJson } from "@/lib/anthropic";
import { CLASSIFY_MAX_TOKENS, type ClassifyInput } from "@/modules/classify";

export const CLASSIFY_PROMPT_V11_VERSION = "v1.1";

export type Stance = "endorses" | "rebuts" | "reports";
const VALID_STANCE = new Set<Stance>(["endorses", "rebuts", "reports"]);

export interface ClassificationMentionV11 {
  issue_slug: string;
  supporting_quote: string;
  stance: Stance;
}

export interface ClassifyResultV11 {
  mentions: ClassificationMentionV11[];
  offTopics: { topic: string; supporting_quote: string }[];
  inputTokens?: number;
  outputTokens?: number;
  rawText: string;
}

export function buildClassifyPromptV11(input: ClassifyInput): string {
  const issuesList = input.issues
    .map((i) => `- ${i.slug}: ${i.name} - ${i.definition}`)
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
   - stance: one of "endorses" | "rebuts" | "reports" (see SPEAKER STANCE below)
3. Multiple distinct mentions of the SAME issue are fine - return each as a separate object.
4. If a passage discusses multiple issues, return one object per issue with a quote that focuses on each.
5. Prioritize quality over quantity. Better to return 3 clear, substantiated mentions than 15 weak ones.
6. If there are NO substantive mentions of ANY taxonomy issue, use an empty "mentions" array.

SPEAKER STANCE - for EACH mention, judge the SHOW'S stance toward the position expressed in the quote, and return it as "stance":
- "endorses": the host/show expresses this as their OWN view, argues for it, or agrees with it.
- "rebuts": the host presents this position - often by quoting, paraphrasing, or playing a clip of someone else (an opponent, a politician, "the other side") - in order to ARGUE AGAINST, mock, fact-check, or disagree with it. The show holds the OPPOSITE view on the issue.
- "reports": the host relays the position neutrally (describing what someone said or what happened) without taking a side.

How to infer stance - the transcripts have NO speaker labels, so infer from context:
- In YouTube captions, ">>" marks a CHANGE OF SPEAKER (a new turn). It is anonymous but useful for telling the host apart from a guest or a played clip.
- Verbal cues for "rebuts": "they say/claim", "the left/right says", "here's what he said", "watch this", "listen to", "supposedly", "so-called", followed by disagreement or ridicule.
- When the speaker is clearly the host stating their own position, default to "endorses".
- Only mark "rebuts" or "reports" when the context makes the non-endorsement clear. If genuinely unsure, use "endorses".

EMERGING-ISSUE DISCOVERY - separately, list any SUBSTANTIVE POLITICAL topic
discussed that is NOT covered by the taxonomy above (a specific bill, event,
policy, scandal, or controversy that maps to none of the issues). Give each a
short, specific label (3–6 words, e.g. "Trump anti-weaponization fund" - not a
vague word like "politics") plus a supporting quote. EXCLUDE anything
non-political (sports, celebrity, ads, market chatter) and anything already
covered by a taxonomy issue above. If none, use an empty "off_taxonomy" array.

OUTPUT FORMAT - return ONLY a JSON object with exactly this shape. No prose, no
markdown code fences, no commentary:
{
  "mentions": [
    {"issue_slug": "immigration", "supporting_quote": "We need to seal the southern border completely.", "stance": "endorses"}
  ],
  "off_taxonomy": [
    {"topic": "Trump anti-weaponization fund", "supporting_quote": "The new fund to claw back what they call weaponized prosecutions..."}
  ]
}`;
}

export async function classifyTranscriptV11(input: ClassifyInput): Promise<ClassifyResultV11> {
  const client = getAnthropicClient();
  const prompt = buildClassifyPromptV11(input);

  const response = await client.messages.create({
    model: MODEL_CLASSIFY,
    max_tokens: CLASSIFY_MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const rawText = textBlock && textBlock.type === "text" ? textBlock.text : "";

  const validSlugs = new Set(input.issues.map((i) => i.slug));
  const parsed = extractJson<unknown>(rawText);
  const obj: { mentions?: unknown; off_taxonomy?: unknown } = Array.isArray(parsed)
    ? { mentions: parsed, off_taxonomy: [] }
    : (parsed as any) || {};

  const rawMentions = Array.isArray(obj.mentions) ? obj.mentions : [];
  const mentions: ClassificationMentionV11[] = (rawMentions as any[])
    .filter(
      (m) =>
        typeof m?.issue_slug === "string" &&
        typeof m?.supporting_quote === "string" &&
        validSlugs.has(m.issue_slug) &&
        m.supporting_quote.length > 0,
    )
    .map((m) => ({
      issue_slug: m.issue_slug,
      supporting_quote: m.supporting_quote,
      // Default to "endorses" when missing/invalid - matches the v1 baseline
      // (v1 ≡ "everything is endorse"), so a dropped field never invents a delta.
      stance: VALID_STANCE.has(m.stance) ? (m.stance as Stance) : "endorses",
    }));

  const rawOff = Array.isArray(obj.off_taxonomy) ? obj.off_taxonomy : [];
  const offTopics = (rawOff as any[])
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
