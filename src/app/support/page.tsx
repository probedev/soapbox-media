import type { Metadata } from "next";

import { SupportLanding, SUPPORT_VARIANTS } from "@/components/SupportLanding";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Support Soapbox — fund media transparency",
  description: "Independent, neutral measurement of what political media is saying. Reader-supported.",
};

export default function SupportPage() {
  return <SupportLanding v={SUPPORT_VARIANTS[""]} />;
}
