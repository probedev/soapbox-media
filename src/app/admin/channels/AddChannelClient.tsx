"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { addChannelAction } from "./actions";

const inputClass =
  "w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300";

interface SuccessNote {
  name: string;
  subs: number;
  fetched: number;
  kept: number;
  upserted: number;
}

export function AddChannelClient() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [handle, setHandle] = useState("");
  const [lean, setLean] = useState<"L" | "M" | "R" | "">("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<SuccessNote | null>(null);

  function submit() {
    setErr(null);
    setOk(null);
    startTransition(async () => {
      const r = await addChannelAction({
        handleOrUrl: handle,
        lean: lean as "L" | "M" | "R",
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
      router.refresh();
    });
  }

  const disabled = pending || !handle.trim() || !lean;

  return (
    <div className="border border-gray-200 rounded-lg bg-white p-5">
      <div className="text-sm font-semibold mb-3">Add a YouTube channel</div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2.5 items-end">
        <label className="text-xs text-gray-600 block">
          Handle or URL
          <input
            type="text"
            className={inputClass}
            placeholder="@channelname or https://youtube.com/@channelname"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            disabled={pending}
          />
        </label>
        <label className="text-xs text-gray-600 block">
          Lean
          <select
            className={inputClass}
            value={lean}
            onChange={(e) => setLean(e.target.value as "L" | "M" | "R" | "")}
            disabled={pending}
          >
            <option value="">L / M / R</option>
            <option value="L">L (Left)</option>
            <option value="M">M (Middle)</option>
            <option value="R">R (Right)</option>
          </select>
        </label>
        <Button onClick={submit} disabled={disabled}>
          {pending ? "Adding…" : "Add channel"}
        </Button>
      </div>
      <div className="text-[11px] text-gray-500 mt-2">
        Resolves via YT API. Requires ≥300K subscribers. Deep-ingests 30 recent
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
