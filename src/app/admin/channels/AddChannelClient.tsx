"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { addChannelAction, previewChannelAction } from "./actions";

const inputClass =
  "w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300";

interface SuccessNote {
  name: string;
  subs: number;
  fetched: number;
  kept: number;
  upserted: number;
}

interface PreviewNote {
  name: string;
  subs: number;
  alreadyInPanel: boolean;
  belowFloor: boolean;
}

export function AddChannelClient() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [drafting, startDrafting] = useTransition();
  const [handle, setHandle] = useState("");
  const [lean, setLean] = useState<"L" | "M" | "R" | "">("");
  const [cohort, setCohort] = useState<"independent" | "legacy">("independent");
  const [rationale, setRationale] = useState("");
  const [preview, setPreview] = useState<PreviewNote | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<SuccessNote | null>(null);

  function draft() {
    setErr(null);
    setOk(null);
    startDrafting(async () => {
      const r = await previewChannelAction(handle, lean as "L" | "M" | "R");
      if (!r.ok) {
        setErr(r.error);
        setPreview(null);
        return;
      }
      // Auto-fill the editable rationale with the generated draft.
      setRationale(r.preview.draftRationale);
      setPreview({
        name: r.preview.name,
        subs: r.preview.subscriberCount,
        alreadyInPanel: r.preview.alreadyInPanel,
        belowFloor: r.preview.belowFloor,
      });
    });
  }

  function submit() {
    setErr(null);
    setOk(null);
    startTransition(async () => {
      const r = await addChannelAction({
        handleOrUrl: handle,
        lean: lean as "L" | "M" | "R",
        cohort,
        rationale,
      });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setOk({
        name: r.result.name,
        subs: r.result.subscriberCount,
        fetched: r.result.fetched,
        kept: r.result.kept,
        upserted: r.result.upserted,
      });
      setHandle("");
      setLean("");
      setCohort("independent");
      setRationale("");
      setPreview(null);
      router.refresh();
    });
  }

  const busy = pending || drafting;
  const canDraft = !busy && !!handle.trim() && !!lean;
  const canSubmit = !busy && !!handle.trim() && !!lean && !!rationale.trim();

  return (
    <div className="border border-gray-200 rounded-lg bg-white p-5">
      <div className="text-sm font-semibold mb-3">Add a YouTube channel</div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2.5 items-end">
        <label className="text-xs text-gray-600 block">
          Handle or URL
          <input
            type="text"
            className={inputClass}
            placeholder="@channelname or https://youtube.com/@channelname"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="text-xs text-gray-600 block">
          Lean
          <select
            className={inputClass}
            value={lean}
            onChange={(e) => setLean(e.target.value as "L" | "M" | "R" | "")}
            disabled={busy}
          >
            <option value="">L / M / R</option>
            <option value="L">L (Left)</option>
            <option value="M">M (Middle)</option>
            <option value="R">R (Right)</option>
          </select>
        </label>
        <label className="text-xs text-gray-600 block">
          Cohort
          <select
            className={inputClass}
            value={cohort}
            onChange={(e) => setCohort(e.target.value as "independent" | "legacy")}
            disabled={busy}
          >
            <option value="independent">Independent</option>
            <option value="legacy">Legacy</option>
          </select>
        </label>
        <Button variant="outline" onClick={draft} disabled={!canDraft}>
          {drafting ? "Drafting…" : "Resolve & draft"}
        </Button>
      </div>

      {preview && (
        <div className="mt-3 text-xs bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-gray-700">
          Resolved <strong>{preview.name}</strong> ({preview.subs.toLocaleString()} subs).
          {preview.alreadyInPanel && (
            <span className="text-amber-700"> ⚠ Already in the panel - adding will be rejected.</span>
          )}
          {preview.belowFloor && (
            <span className="text-amber-700"> ⚠ Below the 300K subscriber floor.</span>
          )}
        </div>
      )}

      <label className="text-xs text-gray-600 block mt-2.5">
        Lean rationale - auto-drafted, edit before adding (appears on /channels)
        <textarea
          rows={2}
          className={inputClass}
          placeholder='Click "Resolve & draft" to auto-generate, or write your own…'
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          disabled={busy}
        />
      </label>
      <div className="flex items-center gap-3 mt-2">
        <Button onClick={submit} disabled={!canSubmit}>
          {pending ? "Adding…" : "Add channel"}
        </Button>
      </div>
      <div className="text-[11px] text-gray-500 mt-2">
        Resolves via YT API. Requires ≥300K subscribers. &ldquo;Resolve &amp; draft&rdquo;
        auto-generates the description (Haiku) for you to edit. Deep-ingests 30 recent
        episodes; the cron processes them automatically.
      </div>
      {err && (
        <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {err}
        </div>
      )}
      {ok && (
        <div className="mt-3 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
          Added <strong>{ok.name}</strong> ({ok.subs.toLocaleString()} subs).
          Ingested {ok.upserted}/{ok.kept} historical episodes ({ok.fetched} fetched, {ok.fetched - ok.kept} filtered as short). Transcribe + classify + score will follow.
        </div>
      )}
    </div>
  );
}
