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
  { key: "channels", label: "Channels", href: "/admin/channels" },
  { key: "channels-audit", label: "Audit", href: "/admin/channels-audit" },
  { key: "discovery", label: "Discovery", href: "/admin/discovery" },
] as const;

export function AdminNav({ active }: { active?: string }) {
  return (
    <div className="flex items-center gap-1 border-b border-gray-200 mb-6 text-sm">
      <span className="text-[10px] uppercase tracking-wider text-gray-400 pr-3 py-2">
        Admin
      </span>
      {LINKS.map((l) => (
        <a
          key={l.key}
          href={l.href}
          className={`px-3 py-2 -mb-px border-b-2 transition ${
            active === l.key
              ? "border-gray-900 text-gray-900 font-medium"
              : "border-transparent text-gray-500 hover:text-gray-900"
          }`}
        >
          {l.label}
        </a>
      ))}
      <div className="ml-auto flex items-center gap-1">
        <a href="/" className="px-3 py-2 text-gray-400 hover:text-gray-700 text-xs">
          View site →
        </a>
        <form action={logout}>
          <Button
            type="submit"
            variant="ghost"
            className="h-auto rounded-none px-3 py-2 text-gray-400 hover:bg-transparent hover:text-gray-700 text-xs font-normal"
          >
            Log out
          </Button>
        </form>
      </div>
    </div>
  );
}
