/**
 * CohortBadge — a small icon (with hover label) marking a channel/episode's
 * cohort: independent (creator / digital-native, mic icon) vs legacy
 * (traditional institution, tv icon). Sits next to the L/M/R lean badge.
 *
 * Gate rendering on `PUBLIC_COHORTS.length > 1` at the call site so it's
 * invisible while the site is independent-only, and appears automatically when
 * legacy is exposed.
 */
import { Mic, Tv } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Cohort } from "@/lib/cohort";

const META: Record<Cohort, { label: string; Icon: typeof Mic }> = {
  independent: { label: "Independent — creator / digital-native channel", Icon: Mic },
  legacy: { label: "Legacy — traditional media institution", Icon: Tv },
};

export function CohortBadge({
  cohort,
  className,
}: {
  cohort: Cohort | string;
  className?: string;
}) {
  const meta = META[cohort as Cohort];
  if (!meta) return null;
  const Icon = meta.Icon;
  return (
    <span
      title={meta.label}
      aria-label={meta.label}
      className={cn("inline-flex items-center text-gray-400", className)}
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}
