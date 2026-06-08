import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SupportLanding, SUPPORT_VARIANTS } from "@/components/SupportLanding";

export const dynamic = "force-dynamic";

const VALID = new Set(["left", "middle", "right"]);

export function generateMetadata({ params }: { params: { lean: string } }): Metadata {
  const v = SUPPORT_VARIANTS[params.lean];
  return v ? { title: "Support Soapbox" } : {};
}

/** L/M/R persuasion variants of the support page (shareable per-audience). */
export default function SupportLeanPage({ params }: { params: { lean: string } }) {
  if (!VALID.has(params.lean)) notFound();
  return <SupportLanding v={SUPPORT_VARIANTS[params.lean]} />;
}
