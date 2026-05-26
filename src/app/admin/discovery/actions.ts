"use server";

import { revalidatePath } from "next/cache";
import {
  promoteCandidate,
  mergeCandidate,
  ignoreCandidate,
  buildDiscoveryCandidates,
  type PromoteInput,
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

export async function refreshAction() {
  const r = await buildDiscoveryCandidates();
  revalidatePath("/admin/discovery");
  return r;
}
