import { VERSION } from "@/lib/version";

/**
 * Shared site footer used on every page. Includes the platform version so
 * the public evolution of soapbox is traceable from the live site, plus
 * /log (Activity) - a secondary transparency surface.
 */
export function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-white">
      <div className="max-w-5xl mx-auto px-6 py-8 text-sm text-gray-500">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span>Soapbox.media · online political media, quantified</span>
            <a
              href="/changelog"
              className="text-xs font-mono text-gray-400 hover:text-gray-700 transition"
              title="View release notes"
            >
              v{VERSION}
            </a>
          </div>
          <div className="flex gap-4">
            <a href="/issues" className="underline hover:text-gray-900">Issues</a>
            <a href="/channels" className="underline hover:text-gray-900">Channels</a>
            <a href="/log" className="underline hover:text-gray-900">Activity</a>
            <a href="/methodology" className="underline hover:text-gray-900">Methodology</a>
            <a href="/mcp" className="underline hover:text-gray-900" title="Connect your AI agent to Soapbox data">For AI Agents</a>
            <a href="/support" className="underline hover:text-gray-900" title="Support our work with a donation">Support our work</a>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-400">
          Built by Breakfastball LLC · © 2026
        </div>
      </div>
    </footer>
  );
}
