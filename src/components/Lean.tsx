/**
 * Shared presentational components for the site's L/R lean language - the chips
 * and the intensity meter that were hand-rolled across ~10 files. Logic + colors
 * live in src/lib/lean.ts. All are plain (no client hooks) so they render in both
 * server and client components; IntensityMeter composes InfoTip for its tooltip.
 */
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/InfoTip";
import { sentimentChipStyle, leanChipStyle } from "@/lib/lean";

const CHIP_BASE = "inline-flex items-center justify-center rounded px-1.5 py-0.5 font-semibold";

/** Per-mention sentiment as an L+/R+ colored chip (the site's signature element). */
export function SentimentChip({
  value,
  className,
}: {
  value: number | null;
  className?: string;
}) {
  const { text, cls } = sentimentChipStyle(value);
  return <span className={cn(CHIP_BASE, "tabular-nums", cls, className)}>{text}</span>;
}

/** Categorical L / R / M lean as a one-letter chip (e.g. who is saying something). */
export function LeanChip({ lean, className }: { lean: string; className?: string }) {
  const { text, cls } = leanChipStyle(lean);
  return <span className={cn(CHIP_BASE, cls, className)}>{text}</span>;
}

/** 5-dot intensity meter (1-5) with a tooltip; `null` reads as 0. */
export function IntensityMeter({ intensity }: { intensity: number | null }) {
  const n = intensity ?? 0;
  return (
    <InfoTip label={`Intensity ${n}/5`}>
      <span className="inline-flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={cn("h-1.5 w-1.5 rounded-full", i <= n ? "bg-ink-body" : "bg-border")}
          />
        ))}
      </span>
    </InfoTip>
  );
}
