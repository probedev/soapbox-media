import type { TrendingPayload } from "@/lib/trending";

/**
 * Trending Names (BETA) — home-page tease. Named entities surging across the
 * tracked panel this week, each linking back to the shows discussing them.
 * Server-rendered from the `trending_v1` snapshot; inline SVG sparkline keeps
 * it dependency-free. Honestly labelled experimental — entity canonicalization
 * is still maturing (see [[lib/trending]]).
 */
function Spark({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const w = 64, h = 20;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible" aria-hidden>
      <polyline points={pts} fill="none" stroke="#6b7280" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function TrendingNames({ data }: { data: TrendingPayload }) {
  if (!data.entities.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h3 className="font-semibold text-gray-900">Trending Names</h3>
        <span className="text-[10px] font-mono uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">beta</span>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        People, organizations, and places surging across tracked shows this week — by how many shows picked them up. Click a show to read where.
      </p>
      <ul className="divide-y divide-gray-100">
        {data.entities.map((e) => (
          <li key={e.name} className="py-2.5 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="font-medium text-gray-900 truncate">{e.name}</span>
                <span className="text-xs text-gray-400 shrink-0">{e.channels} shows</span>
                {e.burst >= 2 && <span className="text-[10px] text-amber-600 shrink-0">▲ {e.burst}×</span>}
              </div>
              <div className="text-xs text-gray-500 truncate mt-0.5">
                {e.topChannels.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && <span className="text-gray-300"> · </span>}
                    <a href={`/channels/${c.id}`} className="hover:text-gray-900 hover:underline">{c.name}</a>
                  </span>
                ))}
              </div>
            </div>
            <Spark values={e.spark} />
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-gray-400 mt-3">
        Experimental — names are detected automatically from transcripts and may occasionally merge or split. Refreshed daily.
      </p>
    </div>
  );
}
