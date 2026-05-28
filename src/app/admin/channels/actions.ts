"use server";

import { revalidatePath } from "next/cache";
import { addYouTubeChannel, type AddChannelInput, type AddChannelResult } from "@/lib/channels";

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
