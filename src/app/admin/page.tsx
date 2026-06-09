import { AdminNav } from "@/components/AdminNav";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const dynamic = "force-dynamic";

const TOOLS = [
  { href: "/admin/pipeline", label: "Pipeline", desc: "Per-stage cron health and recent run detail." },
  { href: "/admin/costs", label: "Costs", desc: "Anthropic burn vs. budget and run-rate." },
  { href: "/admin/channels-audit", label: "Channels audit", desc: "Tracked shows and L/M/R balance." },
  { href: "/admin/discovery", label: "Discovery", desc: "Emerging-issue candidates to review." },
];

export default function AdminHome() {
  return (
    <main className="min-h-screen">
      <Header />
      <section className="px-6 pt-8 pb-16 max-w-5xl mx-auto">
        <AdminNav active="home" />
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Admin</h1>
        <p className="text-ink-muted mt-2 text-sm">Internal tools. Pick one.</p>
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {TOOLS.map((t) => (
            <a
              key={t.href}
              href={t.href}
              className="block border border-border rounded-lg bg-card p-4 hover:bg-subtle hover:border-input transition"
            >
              <div className="font-semibold text-foreground">{t.label}</div>
              <div className="text-sm text-muted-foreground mt-0.5">{t.desc}</div>
            </a>
          ))}
        </div>
      </section>
      <Footer />
    </main>
  );
}
