import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Favorability gauge for public figures (and emerging topics): how critical
 * (left) vs favorable (right) the conversation is toward a SUBJECT, on a -5..+5
 * axis. Deliberately a slate->emerald track, NEVER the red/blue L/R needle -
 * favorability is its own axis (a sanctioned hand-built gauge, like SoapboxNeedle).
 */

function favColor(v: number): string {
  if (v > 0.25) return "text-emerald-700";
  if (v < -0.25) return "text-slate-600";
  return "text-ink-faint";
}

export function favorabilityLabel(v: number): string {
  if (v >= 2) return "Favorable";
  if (v >= 0.25) return "Leaning favorable";
  if (v > -0.25) return "Neutral";
  if (v > -2) return "Leaning critical";
  return "Critical";
}

export function FavorabilityGauge({
  value,
  scoredCount,
  size = "sm",
}: {
  value: number | null;
  scoredCount: number;
  size?: "sm" | "lg";
}) {
  if (value == null) {
    return <span className="text-[11px] text-ink-faint italic">not enough signal</span>;
  }
  const pct = ((value + 5) / 10) * 100; // -5..+5 -> 0..100%
  const valueText = value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
  const lg = size === "lg";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("flex cursor-default flex-col gap-1", lg ? "w-full max-w-md" : "w-28")}>
          <div className={cn("relative rounded-full bg-gradient-to-r from-slate-300 via-muted to-emerald-300", lg ? "h-2.5" : "h-1.5")}>
            <span
              className={cn(
                "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background bg-foreground",
                lg ? "h-4 w-4" : "h-2.5 w-2.5",
              )}
              style={{ left: `${pct}%` }}
            />
          </div>
          <div className={cn("flex items-center justify-between font-medium tabular-nums", lg ? "text-sm" : "text-[10px]")}>
            <span className={favColor(value)}>{favorabilityLabel(value)}</span>
            <span className={favColor(value)}>{valueText}</span>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        Favorability {valueText} on a -5 (critical) to +5 (favorable) scale,
        reach- and intensity-weighted across {scoredCount} stance-bearing mention
        {scoredCount === 1 ? "" : "s"}. A separate axis from the left/right Index.
      </TooltipContent>
    </Tooltip>
  );
}
