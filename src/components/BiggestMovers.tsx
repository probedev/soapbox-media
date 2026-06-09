import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Mover {
  slug: string;
  name: string;
  /** Change in lean week-over-week. Positive = moved right. */
  delta: number;
  /** Last week's lean, -10..+10 */
  fromLean: number;
  /** This week's lean, -10..+10 */
  toLean: number;
  /** Raw mention count in the current window. */
  currentMentions: number;
  /** Raw mention count in the prior (parallel) window. */
  prevMentions: number;
  /** currentMentions / prevMentions - >1 = attention rising, <1 = falling. */
  volumeRatio: number;
}

interface BiggestMoversProps {
  movers: Mover[];
}

function formatLean(v: number): string {
  if (v > 0.05) return `R+${v.toFixed(1)}`;
  if (v < -0.05) return `L+${Math.abs(v).toFixed(1)}`;
  return "0.0";
}

function leanColor(v: number): string {
  if (v > 0.05) return "text-red-600";
  if (v < -0.05) return "text-blue-600";
  return "text-gray-700";
}

/**
 * Volume ratio reads naturally as "↑ 2.3×" when rising and "↓ 0.6×" when
 * falling - the arrow tells direction; the number is always the raw ratio
 * (60% of last week = "↓ 0.6×", not "1.7× lower"). A row with a sub-threshold
 * ratio (it earned its spot on the lean axis instead) gets a neutral dot.
 */
function formatVolumeRatio(r: number): string {
  if (!isFinite(r)) return "·";
  if (r >= 1.05) return `↑ ${r.toFixed(1)}×`;
  if (r <= 0.95) return `↓ ${r.toFixed(1)}×`;
  return "·";
}

function volumeColor(r: number): string {
  // Volume change is ideologically neutral - same gray either way. Slightly
  // dimmer when the ratio is unremarkable so the eye skips it.
  if (r >= 1.05 || r <= 0.95) return "text-gray-700";
  return "text-gray-400";
}

export function BiggestMovers({ movers }: BiggestMoversProps) {
  // Mobile keeps the original three columns (Issue · This week · Change) so
  // the row stays readable on a 360px viewport. Desktop expands to six,
  // adding Last week, Mentions, and Volume so the volume signal is visible.
  const cols =
    "grid grid-cols-[minmax(0,1fr)_4.5rem_5rem] sm:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem_4rem_4.5rem] gap-x-3";

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Biggest movers this week</h2>
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <Table>
          {/* Column sub-headings */}
          <TableHeader>
            <TableRow className={`${cols} px-4 py-2 hover:bg-transparent border-gray-200`}>
              <TableHead className="h-auto p-0 text-[10px] uppercase tracking-wider text-gray-400">Issue</TableHead>
              <TableHead className="h-auto p-0 text-right text-[10px] uppercase tracking-wider text-gray-400 hidden sm:block">Last week</TableHead>
              <TableHead className="h-auto p-0 text-right text-[10px] uppercase tracking-wider text-gray-400">This week</TableHead>
              <TableHead className="h-auto p-0 text-right text-[10px] uppercase tracking-wider text-gray-400">Change</TableHead>
              <TableHead className="h-auto p-0 text-right text-[10px] uppercase tracking-wider text-gray-400 hidden sm:block">Mentions</TableHead>
              <TableHead className="h-auto p-0 text-right text-[10px] uppercase tracking-wider text-gray-400 hidden sm:block">Volume</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {movers.map((m) => {
              const movedRight = m.delta > 0;
              return (
                <TableRow
                  key={m.slug}
                  className={`${cols} items-center px-4 py-3 hover:bg-gray-50 transition border-gray-200 relative`}
                >
                  <TableCell className="p-0 font-medium text-gray-900 truncate">
                    <a href={`/issues/${m.slug}`} className="before:absolute before:inset-0">
                      {m.name}
                    </a>
                  </TableCell>
                  <TableCell className={`p-0 text-right text-sm tabular-nums hidden sm:block ${leanColor(m.fromLean)}`}>
                    {formatLean(m.fromLean)}
                  </TableCell>
                  <TableCell className={`p-0 text-right text-sm tabular-nums font-semibold ${leanColor(m.toLean)}`}>
                    {formatLean(m.toLean)}
                  </TableCell>
                  {/* Neutral arrow = direction of movement on the L<->R axis,
                      decoupled from where the issue currently sits. */}
                  <TableCell className="p-0 text-right text-sm tabular-nums text-gray-500 whitespace-nowrap">
                    {movedRight ? "→" : "←"} {Math.abs(m.delta).toFixed(1)}
                  </TableCell>
                  <TableCell className="p-0 text-right text-sm tabular-nums text-gray-600 hidden sm:block">
                    {m.currentMentions.toLocaleString()}
                  </TableCell>
                  <TableCell className={`p-0 text-right text-sm tabular-nums whitespace-nowrap hidden sm:block ${volumeColor(m.volumeRatio)}`}>
                    {formatVolumeRatio(m.volumeRatio)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-gray-500 mt-3 leading-relaxed">
        Issues earn a row for the biggest shifts this week on either axis: lean
        movement on the left–right scale (→ / ←) or a swing in attention
        (↑ / ↓ mention volume). An issue can move{" "}
        <span className="text-red-600">right</span> (→) yet still sit in{" "}
        <span className="text-blue-600">left</span> territory, or hold steady on
        lean while attention spikes or collapses.
      </p>
    </div>
  );
}
