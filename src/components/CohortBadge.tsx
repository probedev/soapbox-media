"use client";

/**
 * CohortBadge - a small icon (with a styled hover tooltip) marking a
 * channel/episode's cohort: independent (creator / digital-native, mic icon)
 * vs legacy (traditional institution, tv icon). Sits next to the L/M/R lean
 * badge. Uses the shadcn Tooltip (not a native title) so it matches the lean
 * badge's tooltip; requires a <TooltipProvider> ancestor (present on /log via
 * EpisodeDataTable and on /channels via the page wrapper).
 *
 * Gate rendering on `PUBLIC_COHORTS.length > 1` at the call site so it's
 * invisible while the site is independent-only.
 */
import { Mic, Tv } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Cohort } from "@/lib/cohort";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const META: Record<Cohort, { label: string; Icon: typeof Mic }> = {
  independent: { label: "Independent · creator / digital-native channel", Icon: Mic },
  legacy: { label: "Legacy · traditional media institution", Icon: Tv },
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
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={meta.label}
          className={cn("inline-flex items-center text-ink-faint", className)}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{meta.label}</TooltipContent>
    </Tooltip>
  );
}
