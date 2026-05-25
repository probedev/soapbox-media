"use server";

import {
  getBlindedItemsForLabeler,
  saveGoldLabel,
  type BlindedGoldItem,
  type SaveLabelInput,
} from "@/lib/gold";

export async function startLabeling(name: string): Promise<BlindedGoldItem[]> {
  return getBlindedItemsForLabeler(name);
}

export async function saveLabel(input: SaveLabelInput) {
  return saveGoldLabel(input);
}
