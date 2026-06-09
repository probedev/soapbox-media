"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { promoteAction, mergeAction, ignoreAction, refreshAction } from "./actions";
import type { DiscoveryCandidate } from "@/lib/discovery";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const inputClass =
  "w-full border border-input rounded-md px-2.5 py-1.5 text-sm h-auto";

export function DiscoveryClient({
  candidates,
  issueOptions,
  topicOptions,
}: {
  candidates: DiscoveryCandidate[];
  issueOptions: { slug: string; name: string }[];
  topicOptions: { slug: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openPromote, setOpenPromote] = useState<string | null>(null);
  const [form, setForm] = useState({ topic: "", slug: "", name: "", definition: "", left: "", right: "" });
  const [mergeSel, setMergeSel] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  function beginPromote(c: DiscoveryCandidate) {
    setErr(null);
    setOpenPromote(c.id);
    setForm({ topic: "", slug: slugify(c.label), name: c.label, definition: c.summary || "", left: "", right: "" });
  }

  function submitPromote(candidateId: string) {
    setErr(null);
    startTransition(async () => {
      const r = await promoteAction({
        candidateId,
        topicSlug: form.topic,
        slug: form.slug,
        name: form.name,
        definition: form.definition,
        leftPosition: form.left,
        rightPosition: form.right,
      });
      if (r?.error) {
        setErr(r.error);
        return;
      }
      setOpenPromote(null);
      router.refresh();
    });
  }

  function doMerge(id: string) {
    const slug = mergeSel[id];
    if (!slug) return;
    startTransition(async () => {
      await mergeAction(id, slug);
      router.refresh();
    });
  }

  function doIgnore(id: string) {
    startTransition(async () => {
      await ignoreAction(id);
      router.refresh();
    });
  }

  function doRefresh() {
    startTransition(async () => {
      await refreshAction();
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-muted-foreground">
          {candidates.length} pending candidate{candidates.length === 1 ? "" : "s"}
        </div>
        <Button variant="outline" size="sm" onClick={doRefresh} disabled={pending}>
          {pending ? "Working…" : "Refresh candidates"}
        </Button>
      </div>

      {candidates.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No pending candidates. As classify harvests off-taxonomy topics, run
          &ldquo;Refresh candidates&rdquo; (or wait for the weekly job) to cluster them.
        </Card>
      ) : (
        <div className="space-y-3">
          {candidates.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-semibold text-foreground">{c.label}</div>
                  {c.summary && <div className="text-sm text-ink-muted mt-0.5">{c.summary}</div>}
                  <div className="text-xs text-muted-foreground mt-1.5 tabular-nums">
                    weight {c.weight.toLocaleString()} · {c.topic_count} mentions ·{" "}
                    {c.episode_count} episodes · {c.channel_count} channels
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="outline" size="sm" disabled={pending} onClick={() => beginPromote(c)}>
                    Promote
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => doIgnore(c.id)}
                    className="text-muted-foreground"
                  >
                    Ignore
                  </Button>
                </div>
              </div>

              {c.example_quotes.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-l-2 border-muted pl-3">
                  {c.example_quotes.map((q, i) => (
                    <li key={i} className="text-xs text-ink-muted">
                      <span className="text-ink-faint">{q.channel}:</span> &ldquo;{q.quote}&rdquo;
                    </li>
                  ))}
                </ul>
              )}

              {/* Merge into an existing issue */}
              <div className="mt-3 flex items-center gap-2">
                <Select
                  value={mergeSel[c.id] || ""}
                  onValueChange={(v) => setMergeSel((m) => ({ ...m, [c.id]: v }))}
                >
                  <SelectTrigger className="h-auto border border-input rounded-md px-2 py-1 text-xs text-ink-body max-w-[16rem]">
                    <SelectValue placeholder="Merge into existing issue…" />
                  </SelectTrigger>
                  <SelectContent>
                    {issueOptions.map((o) => (
                      <SelectItem key={o.slug} value={o.slug}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  disabled={pending || !mergeSel[c.id]}
                  onClick={() => doMerge(c.id)}
                >
                  Merge
                </Button>
              </div>

              {/* Promote form */}
              {openPromote === c.id && (
                <div className="mt-4 border-t border-muted pt-4 space-y-2.5">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Promote to a new issue
                  </div>
                  <Label className="text-xs text-ink-muted block font-normal leading-normal">
                    Parent topic
                    <Select
                      value={form.topic}
                      onValueChange={(v) => setForm((f) => ({ ...f, topic: v }))}
                    >
                      <SelectTrigger className={inputClass}>
                        <SelectValue placeholder="Choose a topic…" />
                      </SelectTrigger>
                      <SelectContent>
                        {topicOptions.map((t) => (
                          <SelectItem key={t.slug} value={t.slug}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <Label className="text-xs text-ink-muted font-normal leading-normal">
                      Name
                      <Input
                        className={inputClass}
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      />
                    </Label>
                    <Label className="text-xs text-ink-muted font-normal leading-normal">
                      Slug
                      <Input
                        className={inputClass}
                        value={form.slug}
                        onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                      />
                    </Label>
                  </div>
                  <Label className="text-xs text-ink-muted block font-normal leading-normal">
                    Definition
                    <Textarea
                      className={`${inputClass} min-h-0`}
                      rows={2}
                      value={form.definition}
                      onChange={(e) => setForm((f) => ({ ...f, definition: e.target.value }))}
                    />
                  </Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <Label className="text-xs text-blue-700 font-normal leading-normal">
                      Left-leaning position
                      <Textarea
                        className={`${inputClass} min-h-0`}
                        rows={2}
                        value={form.left}
                        onChange={(e) => setForm((f) => ({ ...f, left: e.target.value }))}
                      />
                    </Label>
                    <Label className="text-xs text-red-700 font-normal leading-normal">
                      Right-leaning position
                      <Textarea
                        className={`${inputClass} min-h-0`}
                        rows={2}
                        value={form.right}
                        onChange={(e) => setForm((f) => ({ ...f, right: e.target.value }))}
                      />
                    </Label>
                  </div>
                  {err && <div className="text-xs text-red-600">{err}</div>}
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      disabled={
                        pending ||
                        !form.topic ||
                        !form.slug ||
                        !form.name ||
                        !form.definition ||
                        !form.left ||
                        !form.right
                      }
                      onClick={() => submitPromote(c.id)}
                    >
                      {pending ? "Promoting…" : "Create issue"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setOpenPromote(null)} disabled={pending}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
