import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Editorial timezone for ALL public-facing date/time displays. An episode's
 * publish date is a fact of the record, so we render it in one fixed zone (US
 * Eastern, the news day for US political media) rather than the viewer's local
 * zone. Otherwise the same episode shows a different date to each viewer, and
 * the 10:00 UTC daily ingest reads as "yesterday" for anyone west of UTC. Single
 * source of truth: change this one constant to re-pin the whole site. (Admin /
 * operator timestamps intentionally stay in their own frame for UTC/cron math.)
 */
export const DISPLAY_TZ = "America/New_York";

/** Format an ISO timestamp as a calendar date in the editorial timezone (ET). */
export function formatDateET(
  iso: string,
  opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit" },
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { timeZone: DISPLAY_TZ, ...opts });
}
