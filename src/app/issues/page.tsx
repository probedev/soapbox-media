import { createServiceClient } from "@/lib/db";

export const dynamic = "force-dynamic";

interface IssueRow {
  slug: string;
  name: string;
  definition: string;
  left_position: string;
  right_position: string;
}

export default async function IssuesListPage() {
  const db = createServiceClient();
  const { data: issues } = await db
    .from("issues")
    .select("slug, name, definition, left_position, right_position")
    .eq("active", true)
    .order("name");

  const rows = (issues || []) as IssueRow[];

  return (
    <main className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="flex items-baseline gap-1">
            <span className="font-bold text-xl tracking-tight">soapbox</span>
            <span className="text-xs text-gray-500 hidden sm:inline">.media</span>
          </a>
          <nav className="text-sm text-gray-600 flex gap-6">
            <a href="/issues" className="hover:text-gray-900 font-semibold text-gray-900">Issues</a>
            <a href="/channels" className="hover:text-gray-900">Channels</a>
            <a href="/methodology" className="hover:text-gray-900">Methodology</a>
          </nav>
        </div>
      </header>

      <section className="px-6 pt-10 pb-16 max-w-4xl mx-auto">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">
          <a href="/" className="hover:text-gray-700">← Soapbox Index</a>
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Issue taxonomy</h1>
        <p className="text-gray-600 mt-3 leading-relaxed max-w-3xl">
          The {rows.length} political issues we classify alt-media discourse against. Each issue
          has an explicit left-leaning and right-leaning position — every sentiment score on the
          site is measured against these positions, not against US-political stereotypes. Click
          any issue for the channel-level breakdown.
        </p>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-4">
          {rows.map((i) => (
            <a
              key={i.slug}
              href={`/issues/${i.slug}`}
              className="block border border-gray-200 bg-white rounded-lg p-4 hover:border-gray-400 hover:shadow-sm transition"
            >
              <div className="font-medium text-gray-900">{i.name}</div>
              <div className="text-sm text-gray-600 mt-1 leading-snug">{i.definition}</div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="text-blue-700">
                  <span className="font-semibold uppercase text-[10px] tracking-wider">L</span>{" "}
                  {i.left_position}
                </div>
                <div className="text-red-700">
                  <span className="font-semibold uppercase text-[10px] tracking-wider">R</span>{" "}
                  {i.right_position}
                </div>
              </div>
            </a>
          ))}
        </div>
      </section>

      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-8 text-sm text-gray-500 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <div>Soapbox.media · alt-media discourse, updated daily</div>
          <div className="flex gap-4">
            <a href="/methodology" className="underline hover:text-gray-900">How we measure</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
