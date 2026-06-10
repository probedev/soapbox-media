/**
 * Small shared nav across the (cookie-gated) /admin/* pages so the internal
 * tools are discoverable from one another, with a logout control.
 */
import { logout } from "@/app/admin/login/actions";
import { Button } from "@/components/ui/button";

const LINKS = [
  { key: "home", label: "Home", href: "/admin" },
  { key: "pipeline", label: "Pipeline", href: "/admin/pipeline" },
  { key: "costs", label: "Costs", href: "/admin/costs" },
  { key: "prompts", label: "Prompts", href: "/admin/prompts" },
  { key: "channels", label: "Channels", href: "/admin/channels" },
  { key: "channels-audit", label: "Audit", href: "/admin/channels-audit" },
  { key: "discovery", label: "Discovery", href: "/admin/discovery" },
] as const;

export function AdminNav({ active }: { active?: string }) {
  return (
    <div className="flex items-center gap-1 border-b border-border mb-6 text-sm">
      <span className="text-[10px] uppercase tracking-wider text-ink-faint pr-3 py-2">
        Admin
      </span>
      {LINKS.map((l) => (
        <a
          key={l.key}
          href={l.href}
          className={`px-3 py-2 -mb-px border-b-2 transition ${
            active === l.key
              ? "border-foreground text-foreground font-medium"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {l.label}
        </a>
      ))}
      <div className="ml-auto flex items-center gap-1">
        <a href="/" className="px-3 py-2 text-ink-faint hover:text-ink-body text-xs">
          View site →
        </a>
        <form action={logout}>
          <Button
            type="submit"
            variant="ghost"
            className="h-auto rounded-none px-3 py-2 text-ink-faint hover:bg-transparent hover:text-ink-body text-xs font-normal"
          >
            Log out
          </Button>
        </form>
      </div>
    </div>
  );
}
