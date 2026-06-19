import { protestStrike } from "@/lib/fonts";
import { cn } from "@/lib/utils";

/**
 * The Soapbox wordmark: "soap" in brand red, "box" in brand blue, set in
 * Protest Strike. Single source of truth so the logotype font and colors never
 * drift across the header, auth screens, OG card mirror, and brand page. Pass
 * `className` to size it (e.g. text-2xl); pass `mono` to render both words in
 * one color (e.g. white on a dark surface).
 */
export function Wordmark({
  className,
  mono,
}: {
  className?: string;
  mono?: string;
}) {
  return (
    <span className={cn(protestStrike.className, "tracking-tight leading-none", className)}>
      <span style={{ color: mono ?? "#C8202F" }}>soap</span>
      <span style={{ color: mono ?? "#114A8A" }}>box</span>
    </span>
  );
}
