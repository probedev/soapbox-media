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
  // Shared column template so the header labels line up with the row values.
  // Mobile drops the "Last week" column; sm+ shows all four.
  const cols =
    "grid grid-cols-[minmax(0,1fr)_4.5rem_5rem] sm:grid-cols-[minmax(0,1fr)_5rem_5rem_5rem] gap-x-3";

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Biggest movers this week</h2>
      <div className="border border-gray-200 rounded-lg divide-y divide-gray-200">
        {/* Column sub-headings */}
        <div className={`${cols} px-4 py-2 text-[10px] uppercase tracking-wider text-gray-400`}>
          <div>Issue</div>
          <div className="text-right hidden sm:block">Last week</div>
          <div className="text-right">This week</div>
          <div className="text-right">Change</div>
        </div>
        {movers.map((m) => {
          const movedRight = m.delta > 0;
          return (
            <a
              key={m.slug}
              href={`/issues/${m.slug}`}
              className={`${cols} items-center px-4 py-3 hover:bg-gray-50 transition`}
            >
              <div className="font-medium text-gray-900 truncate">{m.name}</div>
              <div className={`text-right text-sm tabular-nums hidden sm:block ${leanColor(m.fromLean)}`}>
                {formatLean(m.fromLean)}
              </div>
              <div className={`text-right text-sm tabular-nums font-semibold ${leanColor(m.toLean)}`}>
                {formatLean(m.toLean)}
              </div>
              {/* Neutral arrow = direction of movement on the L↔R axis,
                  decoupled from where the issue currently sits. */}
              <div className="text-right text-sm tabular-nums text-gray-500 whitespace-nowrap">
                {movedRight ? "→" : "←"} {Math.abs(m.delta).toFixed(1)}
              </div>
            </a>
          );
        })}
      </div>
      <p className="text-xs text-gray-500 mt-3 leading-relaxed">
        Arrows show the direction of movement on the left–right axis; the colored
        value is where the issue sits now. An issue can move{" "}
        <span className="text-red-600">right</span> (→) yet still be in{" "}
        <span className="text-blue-600">left</span> territory.
      </p>
    </div>
  );
}
