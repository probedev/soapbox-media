"use server";

import { revalidatePath } from "next/cache";
import {
  promoteCandidate,
  mergeCandidate,
  ignoreCandidate,
  buildDiscoveryCandidates,
  type PromoteInput,
  type BuildResult,
} from "@/lib/discovery";

export async function promoteAction(input: PromoteInput) {
  const r = await promoteCandidate(input);
  revalidatePath("/admin/discovery");
  return r;
}

export async function mergeAction(candidateId: string, slug: string) {
  await mergeCandidate(candidateId, slug);
  revalidatePath("/admin/discovery");
}

export async function ignoreAction(candidateId: string) {
  await ignoreCandidate(candidateId);
  revalidatePath("/admin/discovery");
}

export async function refreshAction(): Promise<{ result?: BuildResult; error?: string }> {
  try {
    const result = await buildDiscoveryCandidates();
    revalidatePath("/admin/discovery");
    return { result };
  } catch (e) {
    // Surface clustering failures (e.g. model output truncation) instead of
    // silently leaving the candidate list empty - the old swallow-and-return
    // behavior is exactly what hid the max_tokens truncation bug.
    return { error: (e as Error)?.message || String(e) };
  }
}
