/**
 * Small legend defining the cohort icons used by <CohortBadge> (mic =
 * independent, tv = legacy). Place near the channel list / episode table. Gray
 * to match the badge icons it explains. Gate on PUBLIC_COHORTS.length > 1.
 */
import { Mic, Tv } from "lucide-react";
import { cn } from "@/lib/utils";

export function CohortLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-4 text-[11px] text-muted-foreground", className)}>
      <span className="flex items-center gap-1">
        <Mic className="h-3.5 w-3.5 text-ink-faint" /> Independent
      </span>
      <span className="flex items-center gap-1">
        <Tv className="h-3.5 w-3.5 text-ink-faint" /> Legacy
      </span>
    </div>
  );
}
