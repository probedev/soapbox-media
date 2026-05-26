"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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
  "w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300";

export function DiscoveryClient({
  candidates,
  issueOptions,
}: {
  candidates: DiscoveryCandidate[];
  issueOptions: { slug: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openPromote, setOpenPromote] = useState<string | null>(null);
  const [form, setForm] = useState({ slug: "", name: "", definition: "", left: "", right: "" });
  const [mergeSel, setMergeSel] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  function beginPromote(c: DiscoveryCandidate) {
    setErr(null);
    setOpenPromote(c.id);
    setForm({ slug: slugify(c.label), name: c.label, definition: c.summary || "", left: "", right: "" });
  }

  function submitPromote(candidateId: string) {
    setErr(null);
    startTransition(async () => {
      const r = await promoteAction({
        candidateId,
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
        <div className="text-sm text-gray-500">
          {candidates.length} pending candidate{candidates.length === 1 ? "" : "s"}
        </div>
        <Button variant="outline" size="sm" onClick={doRefresh} disabled={pending}>
          {pending ? "Working…" : "Refresh candidates"}
        </Button>
      </div>

      {candidates.length === 0 ? (
        <div className="border border-gray-200 rounded-lg bg-white p-8 text-center text-sm text-gray-500">
          No pending candidates. As classify harvests off-taxonomy topics, run
          &ldquo;Refresh candidates&rdquo; (or wait for the weekly job) to cluster them.
        </div>
      ) : (
        <div className="space-y-3">
          {candidates.map((c) => (
            <div key={c.id} className="border border-gray-200 rounded-lg bg-white p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900">{c.label}</div>
                  {c.summary && <div className="text-sm text-gray-600 mt-0.5">{c.summary}</div>}
                  <div className="text-xs text-gray-500 mt-1.5 tabular-nums">
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
                    className="text-gray-500"
                  >
                    Ignore
                  </Button>
                </div>
              </div>

              {c.example_quotes.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-l-2 border-gray-100 pl-3">
                  {c.example_quotes.map((q, i) => (
                    <li key={i} className="text-xs text-gray-600">
                      <span className="text-gray-400">{q.channel}:</span> &ldquo;{q.quote}&rdquo;
                    </li>
                  ))}
                </ul>
              )}

              {/* Merge into an existing issue */}
              <div className="mt-3 flex items-center gap-2">
                <select
                  className="border border-gray-300 rounded-md px-2 py-1 text-xs text-gray-700 max-w-[16rem]"
                  value={mergeSel[c.id] || ""}
                  onChange={(e) => setMergeSel((m) => ({ ...m, [c.id]: e.target.value }))}
                >
                  <option value="">Merge into existing issue…</option>
                  {issueOptions.map((o) => (
                    <option key={o.slug} value={o.slug}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-gray-500"
                  disabled={pending || !mergeSel[c.id]}
                  onClick={() => doMerge(c.id)}
                >
                  Merge
                </Button>
              </div>

              {/* Promote form */}
              {openPromote === c.id && (
                <div className="mt-4 border-t border-gray-100 pt-4 space-y-2.5">
                  <div className="text-xs uppercase tracking-wider text-gray-500">
                    Promote to taxonomy issue
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <label className="text-xs text-gray-600">
                      Name
                      <input
                        className={inputClass}
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      />
                    </label>
                    <label className="text-xs text-gray-600">
                      Slug
                      <input
                        className={inputClass}
                        value={form.slug}
                        onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                      />
                    </label>
                  </div>
                  <label className="text-xs text-gray-600 block">
                    Definition
                    <textarea
                      className={inputClass}
                      rows={2}
                      value={form.definition}
                      onChange={(e) => setForm((f) => ({ ...f, definition: e.target.value }))}
                    />
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <label className="text-xs text-blue-700">
                      Left-leaning position
                      <textarea
                        className={inputClass}
                        rows={2}
                        value={form.left}
                        onChange={(e) => setForm((f) => ({ ...f, left: e.target.value }))}
                      />
                    </label>
                    <label className="text-xs text-red-700">
                      Right-leaning position
                      <textarea
                        className={inputClass}
                        rows={2}
                        value={form.right}
                        onChange={(e) => setForm((f) => ({ ...f, right: e.target.value }))}
                      />
                    </label>
                  </div>
                  {err && <div className="text-xs text-red-600">{err}</div>}
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      disabled={
                        pending ||
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
