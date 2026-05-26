/**
 * Discover module — merge raw off-taxonomy topic labels (harvested during
 * classify) into candidate emerging-issue themes via a single Haiku pass.
 * Synonyms/rephrasings of the same underlying issue collapse into one theme;
 * genuinely distinct topics stay separate. Pure proposal — a human decides
 * whether any theme becomes a taxonomy issue.
 */
import { getAnthropicClient, MODEL_SCORE, extractJson } from "@/lib/anthropic";

export interface LabelInput {
  label: string;
  count: number;
}

export interface TopicTheme {
  canonical_label: string;
  summary: string;
  /** Indices into the LabelInput[] passed in. */
  member_indices: number[];
}

export interface ClusterResult {
  themes: TopicTheme[];
  inputTokens?: number;
  outputTokens?: number;
}

function buildPrompt(labels: LabelInput[]): string {
  const list = labels.map((l, i) => `${i}: "${l.label}" (×${l.count})`).join("\n");
  return `You are grouping off-taxonomy political topics extracted from US political talk shows (podcasts + YouTube) into EMERGING-ISSUE candidates. Below is a numbered list of topic labels with how many times each appeared.

Group labels into emerging-issue themes, and merge AGGRESSIVELY: labels about the same broader issue, country, person, event, or policy area belong in ONE theme even when they emphasize different angles or sub-aspects (e.g. "Afghanistan withdrawal failure" and "Afghanistan war accountability" → a single "Afghanistan war" theme; several Trump-corruption angles → one theme). Prefer fewer, broader themes over many narrow ones. Only keep topics separate when they are genuinely about different subjects. A truly unique one-off can stand alone.

For each theme return:
- canonical_label: a concise, specific name for the emerging issue (3–6 words)
- summary: one neutral sentence describing what it is
- member_indices: the indices of every input label belonging to this theme

LABELS:
${list}

OUTPUT — return ONLY a JSON array, no prose, no markdown fences:
[{"canonical_label": "...", "summary": "...", "member_indices": [0, 4]}]`;
}

export async function clusterTopics(labels: LabelInput[]): Promise<ClusterResult> {
  if (labels.length === 0) return { themes: [] };

  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: MODEL_SCORE,
    max_tokens: 4096,
    messages: [{ role: "user", content: buildPrompt(labels) }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const rawText = textBlock && textBlock.type === "text" ? textBlock.text : "";
  const parsed = extractJson<unknown>(rawText);
  const maxIdx = labels.length - 1;
  const themes: TopicTheme[] = Array.isArray(parsed)
    ? (parsed as any[])
        .filter(
          (t) =>
            typeof t?.canonical_label === "string" &&
            t.canonical_label.trim().length > 0 &&
            Array.isArray(t?.member_indices),
        )
        .map((t) => ({
          canonical_label: String(t.canonical_label).slice(0, 120),
          summary: typeof t?.summary === "string" ? String(t.summary).slice(0, 300) : "",
          member_indices: (t.member_indices as any[])
            .map((n) => Number(n))
            .filter((n) => Number.isInteger(n) && n >= 0 && n <= maxIdx),
        }))
        .filter((t) => t.member_indices.length > 0)
    : [];

  return {
    themes,
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
  };
}
