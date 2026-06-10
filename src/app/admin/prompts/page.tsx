import { getPromptCatalog, PROMPT_LIMITATIONS } from "@/lib/prompts";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdminNav } from "@/components/AdminNav";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const dynamic = "force-dynamic";

export default function AdminPromptsPage() {
  const catalog = getPromptCatalog();

  return (
    <main className="min-h-screen">
      <Header />
      <section className="px-6 pt-8 pb-16 max-w-5xl mx-auto">
        <AdminNav active="prompts" />
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Pipeline prompts</h1>
        <p className="text-ink-muted mt-2 text-sm leading-relaxed max-w-3xl">
          The exact system prompts and models the classify and score stages run, with version
          labels. Templates are rendered from the live prompt builders (dynamic slots shown as{" "}
          <code className="text-xs bg-subtle px-1 py-0.5 rounded">{"{{PLACEHOLDERS}}"}</code>), so
          this page can never drift from production. Bump a stage&apos;s prompt version in code when
          you change its prompt; validate any classify or score change against the gold set first.
        </p>

        <div className="mt-8 space-y-6">
          {catalog.map((p) => (
            <Card key={p.stage} className="p-5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-lg font-semibold">{p.title}</h2>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="font-mono text-xs">
                    {p.model}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    prompt {p.version}
                  </Badge>
                  <Badge variant="outline" className="text-xs tabular-nums">
                    max_tokens {p.maxTokens.toLocaleString()}
                  </Badge>
                </div>
              </div>

              <p className="text-sm text-ink-muted mt-2 max-w-3xl">{p.description}</p>

              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-4 mb-1.5">
                Dynamic inputs
              </div>
              <ul className="text-xs text-ink-muted list-disc pl-5 space-y-0.5">
                {p.dynamicInputs.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>

              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-4 mb-1.5">
                Prompt template
              </div>
              <pre className="text-xs leading-relaxed bg-subtle border border-border rounded-md p-4 overflow-x-auto whitespace-pre-wrap text-ink-body">
                {p.prompt}
              </pre>
            </Card>
          ))}
        </div>

        <Card className="p-5 mt-6 border-amber-300 bg-amber-50/50">
          <h2 className="text-lg font-semibold">Maturation backlog · known limitations</h2>
          <p className="text-sm text-ink-muted mt-1 max-w-3xl">
            Validity gaps in the current prompts. These are the candidates for the next prompt
            versions; each must be validated against the gold set (/eval/label) before shipping.
          </p>
          <div className="mt-4 space-y-4">
            {PROMPT_LIMITATIONS.map((l, i) => (
              <div key={i}>
                <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                  {l.title}
                  {l.raisedBy && (
                    <span className="text-[10px] uppercase tracking-wider text-ink-faint">
                      {l.raisedBy}
                    </span>
                  )}
                </div>
                <p className="text-sm text-ink-muted mt-0.5 leading-relaxed max-w-3xl">{l.detail}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>
      <Footer />
    </main>
  );
}
