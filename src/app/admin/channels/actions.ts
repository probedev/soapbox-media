"use server";

import { revalidatePath } from "next/cache";
import {
  addYouTubeChannel,
  previewYouTubeChannel,
  type AddChannelInput,
  type AddChannelResult,
  type ChannelPreview,
} from "@/lib/channels";

export async function addChannelAction(
  input: AddChannelInput,
): Promise<{ ok: true; result: AddChannelResult } | { ok: false; error: string }> {
  try {
    const result = await addYouTubeChannel(input);
    revalidatePath("/admin/channels");
    return { ok: true, result };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Resolve a handle + auto-draft a rationale for the admin to edit. Read-only —
 * the admin reviews/edits the draft, then commits via addChannelAction.
 */
export async function previewChannelAction(
  handleOrUrl: string,
  lean: "L" | "M" | "R",
): Promise<{ ok: true; preview: ChannelPreview } | { ok: false; error: string }> {
  try {
    const preview = await previewYouTubeChannel(handleOrUrl, lean);
    return { ok: true, preview };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
