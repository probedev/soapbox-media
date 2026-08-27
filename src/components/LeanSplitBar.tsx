import type { AdLeanShare } from "@/lib/aggregate";

/**
 * Tiny 1-D placement-share bar: blue = left-leaning channels, gray = middle,
 * red = right-leaning, per the house lean palette (src/lib/lean.ts). Same
 * family as the sanctioned hand-built 1-D position markers - there is no
 * shadcn/Recharts primitive for an inline three-way split this small.
 */
export function LeanSplitBar({ share, className = "" }: { share: AdLeanShare; className?: string }) {
  const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
  const label = `${Math.round(share.left * 100)}% left / ${Math.round(share.middle * 100)}% middle / ${Math.round(share.right * 100)}% right (reach-weighted)`;
  return (
    <div
      className={`flex h-2 w-24 overflow-hidden rounded-full bg-muted ${className}`}
      role="img"
      aria-label={label}
      title={label}
    >
      <div className="bg-blue-600 h-full" style={{ width: pct(share.left) }} />
      <div className="bg-slate-400 h-full" style={{ width: pct(share.middle) }} />
      <div className="bg-red-600 h-full" style={{ width: pct(share.right) }} />
    </div>
  );
}
