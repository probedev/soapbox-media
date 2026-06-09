/**
 * READ-ONLY diagnostic for the discovery clustering step. Replicates what
 * buildDiscoveryCandidates does up to (and including) the Haiku call, but writes
 * NOTHING to the DB. Reports stop_reason, token counts, raw output length, and
 * whether extractJson succeeds — to find why discovery_candidates is empty.
 *
 * Run with:  tsx scripts/probe-discovery.ts
 */
import "./_load-env";

import { createServiceClient } from "@/lib/db";
import { getAnthropicClient, MODEL_SCORE, extractJson } from "@/lib/anthropic";

async function main() {
  const db = createServiceClient();
  const windowDays = 21;
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - windowDays);

  // Mirror loadUnclusteredTopics, but only need labels.
  const labels: string[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("discovery_topics")
      .select("id, label")
      .is("candidate_id", null)
      .gte("created_at", since.toISOString())
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const r of data as any[]) if (r.label) labels.push(r.label);
    if (data.length < pageSize) break;
  }

  const groups = new Map<string, number>();
  for (const l of labels) {
    const norm = l.trim().toLowerCase();
    if (!norm) continue;
    groups.set(norm, (groups.get(norm) || 0) + 1);
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 250);

  console.log(`Topics loaded:        ${labels.length}`);
  console.log(`Distinct labels:      ${groups.size}`);
  console.log(`Sent to Haiku (cap):  ${ordered.length}`);
  console.log(`Top 10 labels:`);
  for (const [lab, n] of ordered.slice(0, 10)) console.log(`   ×${n}  ${lab}`);

  const list = ordered.map(([l, c], i) => `${i}: "${l}" (×${c})`).join("\n");
  const prompt = `You are grouping off-taxonomy political topics extracted from US political talk shows (podcasts + YouTube) into EMERGING-ISSUE candidates. Below is a numbered list of topic labels with how many times each appeared.

Group labels into emerging-issue themes, and merge AGGRESSIVELY. Prefer fewer, broader themes.

For each theme return:
- canonical_label: a concise, specific name (3-6 words)
- summary: one neutral sentence
- member_indices: the indices of every input label belonging to this theme

LABELS:
${list}

OUTPUT - return ONLY a JSON array, no prose, no markdown fences:
[{"canonical_label": "...", "summary": "...", "member_indices": [0, 4]}]`;

  const client = getAnthropicClient();
  const resp = await client.messages.create({
    model: MODEL_SCORE,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const block = resp.content.find((b) => b.type === "text");
  const raw = block && block.type === "text" ? block.text : "";
  const parsed = extractJson<unknown[]>(raw);

  console.log(`\n--- Haiku response ---`);
  console.log(`stop_reason:          ${resp.stop_reason}`);
  console.log(`input_tokens:         ${resp.usage?.input_tokens}`);
  console.log(`output_tokens:        ${resp.usage?.output_tokens}  (cap 4096)`);
  console.log(`raw text length:      ${raw.length} chars`);
  console.log(`last 120 chars:       ${JSON.stringify(raw.slice(-120))}`);
  console.log(`extractJson result:   ${parsed === null ? "NULL (parse FAILED)" : `${(parsed as any[]).length} themes`}`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
