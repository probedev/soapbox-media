/**
 * Gold-set labeling helpers. Server-side only (service-role client). The
 * labeler-facing surface is deliberately blinded - no model scores, no channel
 * name, no classification id ever reaches the browser.
 */
import { createServiceClient } from "./db";

export interface BlindedGoldItem {
  id: string;
  row_num: number;
  quote: string;
  issue_name: string;
  issue_left_position: string;
  issue_right_position: string;
  channel_lean: "L" | "M" | "R";
  episode_date: string | null;
  /** Whether the current labeler has already scored this item. */
  done: boolean;
}

/** Blinded items in display order, flagged with what this labeler has done. */
export async function getBlindedItemsForLabeler(
  labelerName: string,
): Promise<BlindedGoldItem[]> {
  const db = createServiceClient();
  const { data: items, error } = await db
    .from("gold_items")
    .select(
      "id, row_num, quote, issue_name, issue_left_position, issue_right_position, channel_lean, episode_date",
    )
    .order("row_num", { ascending: true });
  if (error) {
    console.error("getBlindedItemsForLabeler:", error.message);
    return [];
  }
  const name = labelerName.trim();
  const done = new Set<string>();
  if (name) {
    const { data: labels } = await db
      .from("gold_labels")
      .select("item_id")
      .eq("labeler_name", name);
    for (const l of (labels || []) as { item_id: string }[]) done.add(l.item_id);
  }
  return (items || []).map((it: any) => ({
    id: it.id,
    row_num: it.row_num,
    quote: it.quote,
    issue_name: it.issue_name,
    issue_left_position: it.issue_left_position,
    issue_right_position: it.issue_right_position,
    channel_lean: it.channel_lean,
    episode_date: it.episode_date,
    done: done.has(it.id),
  }));
}

export interface SaveLabelInput {
  labelerName: string;
  itemId: string;
  sentiment: number;
  intensity: number;
  confidence: number;
  notes?: string;
}

export async function saveGoldLabel(
  input: SaveLabelInput,
): Promise<{ ok: boolean; error?: string }> {
  const name = input.labelerName.trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (!Number.isInteger(input.sentiment) || input.sentiment < -5 || input.sentiment > 5)
    return { ok: false, error: "Sentiment must be an integer −5…+5." };
  if (!Number.isInteger(input.intensity) || input.intensity < 1 || input.intensity > 5)
    return { ok: false, error: "Intensity must be an integer 1…5." };
  if (!Number.isInteger(input.confidence) || input.confidence < 1 || input.confidence > 3)
    return { ok: false, error: "Confidence must be an integer 1…3." };

  const db = createServiceClient();
  const { error } = await db.from("gold_labels").upsert(
    {
      item_id: input.itemId,
      labeler_name: name,
      sentiment: input.sentiment,
      intensity: input.intensity,
      confidence: input.confidence,
      notes: input.notes?.trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "item_id,labeler_name" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
