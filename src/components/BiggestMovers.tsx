interface Mover {
  slug: string;
  name: string;
  /** Change in lean week-over-week. Positive = moved right. */
  delta: number;
  /** Last week's lean, -10..+10 */
  fromLean: number;
  /** This week's lean, -10..+10 */
  toLean: number;
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

export function BiggestMovers({ movers }: BiggestMoversProps) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-lg font-semibold">Biggest movers this week</h2>
        <span className="text-xs text-gray-500">Δ from last week</span>
      </div>
      <div className="border border-gray-200 rounded-lg divide-y divide-gray-200">
        {movers.map((m) => {
          const movedRight = m.delta > 0;
          return (
            <a
              key={m.slug}
              href={`/issues/${m.slug}`}
              className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50 transition"
            >
              <div className="font-medium text-gray-900">{m.name}</div>
              <div className="flex items-center gap-3 text-sm tabular-nums">
                <span className={`${leanColor(m.fromLean)} hidden sm:inline`}>
                  {formatLean(m.fromLean)}
                </span>
                <span className="text-gray-400 hidden sm:inline">→</span>
                <span className={`font-semibold ${leanColor(m.toLean)}`}>
                  {formatLean(m.toLean)}
                </span>
                <span
                  className={`font-semibold ${
                    movedRight ? "text-red-600" : "text-blue-600"
                  } min-w-[3.25rem] text-right`}
                >
                  {movedRight ? "↑" : "↓"} {Math.abs(m.delta).toFixed(1)}
                </span>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
