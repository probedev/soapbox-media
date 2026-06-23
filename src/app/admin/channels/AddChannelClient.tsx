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
import { addChannelAction, previewChannelAction } from "./actions";

const inputClass =
  "w-full border border-input rounded-md px-2.5 py-1.5 text-sm h-auto";

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
  mirror?: { channelName: string; platform: string; matched: number; sampleSize: number };
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
        mirror: r.preview.possibleMirror,
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
    <Card className="p-5">
      <div className="text-sm font-semibold mb-3">Add a YouTube channel</div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2.5 items-end">
        <Label className="text-xs text-ink-muted block font-normal leading-normal">
          Handle or URL
          <Input
            type="text"
            className={inputClass}
            placeholder="@channelname or https://youtube.com/@channelname"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            disabled={busy}
          />
        </Label>
        <Label className="text-xs text-ink-muted block font-normal leading-normal">
          Lean
          <Select
            value={lean}
            onValueChange={(v) => setLean(v as "L" | "M" | "R" | "")}
            disabled={busy}
          >
            <SelectTrigger className={inputClass}>
              <SelectValue placeholder="L / M / R" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="L">L (Left)</SelectItem>
              <SelectItem value="M">M (Middle)</SelectItem>
              <SelectItem value="R">R (Right)</SelectItem>
            </SelectContent>
          </Select>
        </Label>
        <Label className="text-xs text-ink-muted block font-normal leading-normal">
          Cohort
          <Select
            value={cohort}
            onValueChange={(v) => setCohort(v as "independent" | "legacy")}
            disabled={busy}
          >
            <SelectTrigger className={inputClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="independent">Independent</SelectItem>
              <SelectItem value="legacy">Legacy</SelectItem>
            </SelectContent>
          </Select>
        </Label>
        <Button variant="outline" onClick={draft} disabled={!canDraft}>
          {drafting ? "Drafting…" : "Resolve & draft"}
        </Button>
      </div>

      {preview && (
        <div className="mt-3 text-xs bg-subtle border border-border rounded-md px-3 py-2 text-ink-body">
          Resolved <strong>{preview.name}</strong> ({preview.subs.toLocaleString()} subs).
          {preview.alreadyInPanel && (
            <span className="text-amber-700"> ⚠ Already in the panel - adding will be rejected.</span>
          )}
          {preview.belowFloor && (
            <span className="text-amber-700"> ⚠ Below the 200K subscriber floor.</span>
          )}
          {preview.mirror && (
            <div className="mt-2 text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 leading-relaxed">
              ⚠ <strong>Likely a cross-platform mirror</strong> of{" "}
              <strong>{preview.mirror.channelName}</strong> ({preview.mirror.platform}):{" "}
              {preview.mirror.matched}/{preview.mirror.sampleSize} recent episodes match by
              date + title. The auto-dedup only links feeds with the same name and titles, so
              adding this will <strong>double-count this show</strong> in the Index. Deactivate
              one side instead, or proceed only if they are genuinely different shows.
            </div>
          )}
        </div>
      )}

      <Label className="text-xs text-ink-muted block mt-2.5 font-normal leading-normal">
        Lean rationale - auto-drafted, edit before adding (appears on /channels)
        <Textarea
          rows={2}
          className={`${inputClass} min-h-0`}
          placeholder='Click "Resolve & draft" to auto-generate, or write your own…'
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          disabled={busy}
        />
      </Label>
      <div className="flex items-center gap-3 mt-2">
        <Button onClick={submit} disabled={!canSubmit}>
          {pending ? "Adding…" : "Add channel"}
        </Button>
      </div>
      <div className="text-[11px] text-muted-foreground mt-2">
        Resolves via YT API. Requires ≥200K subscribers. &ldquo;Resolve &amp; draft&rdquo;
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
    </Card>
  );
}
