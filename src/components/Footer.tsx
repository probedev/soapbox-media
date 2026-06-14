import { VERSION } from "@/lib/version";
import { TAGLINE_FOOTER } from "@/lib/brand";

/**
 * Shared site footer used on every page. Includes the platform version so
 * the public evolution of soapbox is traceable from the live site, plus
 * /log (Activity) - a secondary transparency surface.
 */
export function Footer() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="max-w-5xl mx-auto px-6 py-8 text-sm text-muted-foreground">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span>Soapbox.media · {TAGLINE_FOOTER}</span>
            <a
              href="/changelog"
              className="text-xs font-mono text-ink-faint hover:text-ink-body transition"
              title="View release notes"
            >
              v{VERSION}
            </a>
          </div>
          <div className="flex gap-4">
            <a href="/issues" className="underline hover:text-foreground">Issues</a>
            <a href="/channels" className="underline hover:text-foreground">Channels</a>
            <a href="/log" className="underline hover:text-foreground">Activity</a>
            <a href="/methodology" className="underline hover:text-foreground">Methodology</a>
            <a href="/mcp" className="underline hover:text-foreground" title="Connect your AI agent to Soapbox data">For AI Agents</a>
            <a href="/support" className="underline hover:text-foreground" title="Support our work with a donation">Support our work</a>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-muted text-xs text-ink-faint">
          Built by Breakfastball LLC · © 2026
        </div>
      </div>
    </footer>
  );
}
