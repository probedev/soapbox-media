import { VERSION } from "@/lib/version";
import { TAGLINE_FOOTER } from "@/lib/brand";
import { InfoTip } from "@/components/InfoTip";

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
            <InfoTip label="View release notes">
              <a
                href="/changelog"
                className="text-xs font-mono text-ink-faint hover:text-ink-body transition"
              >
                v{VERSION}
              </a>
            </InfoTip>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 md:justify-end">
            <a href="/issues" className="underline hover:text-foreground whitespace-nowrap">Issues</a>
            <a href="/channels" className="underline hover:text-foreground whitespace-nowrap">Channels</a>
            <a href="/log" className="underline hover:text-foreground whitespace-nowrap">Activity</a>
            <a href="/methodology" className="underline hover:text-foreground whitespace-nowrap">Methodology</a>
            <a href="/brand" className="underline hover:text-foreground whitespace-nowrap">Brand</a>
            <InfoTip label="Connect your AI agent to Soapbox data">
              <a href="/mcp" className="underline hover:text-foreground whitespace-nowrap">For AI Agents</a>
            </InfoTip>
            <InfoTip label="Support our work with a donation">
              <a href="/support" className="underline hover:text-foreground whitespace-nowrap">Support our work</a>
            </InfoTip>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-muted text-xs text-ink-faint">
          Built by Breakfastball LLC · © 2026
        </div>
      </div>
    </footer>
  );
}
