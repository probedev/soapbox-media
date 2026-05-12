import { VERSION } from "@/lib/version";

/**
 * Shared site footer used on every page. Includes the platform version so
 * the public evolution of soapbox is traceable from the live site.
 */
export function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-white">
      <div className="max-w-5xl mx-auto px-6 py-8 text-sm text-gray-500 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span>Soapbox.media · alt-media discourse, updated daily</span>
          <a
            href="https://github.com/probedev/soapbox-media/blob/main/CHANGELOG.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-gray-400 hover:text-gray-700 transition"
            title="View release notes"
          >
            v{VERSION}
          </a>
        </div>
        <div className="flex gap-4">
          <a href="/issues" className="underline hover:text-gray-900">Issues</a>
          <a href="/channels" className="underline hover:text-gray-900">Channels</a>
          <a href="/methodology" className="underline hover:text-gray-900">Methodology</a>
        </div>
      </div>
    </footer>
  );
}
