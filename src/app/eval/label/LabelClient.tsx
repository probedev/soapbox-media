"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { startLabeling, saveLabel } from "./actions";
import type { BlindedGoldItem } from "@/lib/gold";

type Phase = "intro" | "labeling" | "done";

const SENTIMENT_VALUES = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
const INTENSITY_VALUES = [1, 2, 3, 4, 5];
const CONFIDENCE_VALUES = [1, 2, 3];

function Segmented({
  values,
  value,
  onChange,
  format = (v) => String(v),
  ariaLabel,
}: {
  values: number[];
  value: number | null;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  ariaLabel: string;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={ariaLabel}>
      {values.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            "h-9 min-w-[2.25rem] px-2 rounded-md border text-sm tabular-nums transition",
            value === v
              ? "border-gray-900 bg-gray-900 text-white"
              : "border-gray-300 text-gray-700 hover:border-gray-500",
          )}
        >
          {format(v)}
        </button>
      ))}
    </div>
  );
}

function leanSource(lean: "L" | "M" | "R"): string {
  return `${lean}-coded channel`;
}

export function LabelClient() {
  const [phase, setPhase] = React.useState<Phase>("intro");
  const [name, setName] = React.useState("");
  const [items, setItems] = React.useState<BlindedGoldItem[]>([]);
  const [index, setIndex] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // current-item inputs
  const [sentiment, setSentiment] = React.useState<number | null>(null);
  const [intensity, setIntensity] = React.useState<number | null>(null);
  const [confidence, setConfidence] = React.useState<number | null>(null);
  const [notes, setNotes] = React.useState("");

  const total = items.length;
  const doneCount = items.filter((i) => i.done).length;
  const current = items[index];

  function resetInputs() {
    setSentiment(null);
    setIntensity(null);
    setConfidence(null);
    setNotes("");
  }

  function firstUndone(list: BlindedGoldItem[]): number {
    const i = list.findIndex((x) => !x.done);
    return i === -1 ? list.length : i;
  }

  async function handleStart() {
    setError(null);
    if (!name.trim()) {
      setError("Please enter your name to begin.");
      return;
    }
    setBusy(true);
    try {
      const list = await startLabeling(name);
      setItems(list);
      if (list.length === 0) {
        setError("No items are available to label yet. Check back shortly.");
        setBusy(false);
        return;
      }
      const start = firstUndone(list);
      setIndex(start);
      resetInputs();
      setPhase(start >= list.length ? "done" : "labeling");
    } catch {
      setError("Could not load the items. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit() {
    if (!current) return;
    if (sentiment === null || intensity === null || confidence === null) {
      setError("Please choose a sentiment, intensity, and confidence.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await saveLabel({
        labelerName: name,
        itemId: current.id,
        sentiment,
        intensity,
        confidence,
        notes,
      });
      if (!res.ok) {
        setError(res.error || "Could not save. Please try again.");
        setBusy(false);
        return;
      }
      // mark done locally and advance
      const updated = items.map((it) =>
        it.id === current.id ? { ...it, done: true } : it,
      );
      setItems(updated);
      const next = firstUndone(updated);
      resetInputs();
      if (next >= updated.length) {
        setPhase("done");
      } else {
        setIndex(next);
      }
    } catch {
      setError("Could not save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // ── Intro ────────────────────────────────────────────────────────────────
  if (phase === "intro") {
    return (
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Scoring calibration
        </h1>
        <p className="text-gray-600 mt-3 leading-relaxed">
          Thanks for helping calibrate Soapbox. You&apos;ll score short quotes
          from political shows on two scales the platform uses. We compare your
          independent judgment against the model&apos;s to find where it&apos;s
          wrong. There are no trick questions — go with your gut, and try to
          finish in one sitting.
        </p>

        <div className="mt-6 space-y-5 text-sm text-gray-700 leading-relaxed">
          <div>
            <div className="font-semibold text-gray-900">Sentiment (−5…+5)</div>
            <p className="mt-1">
              How strongly the quote aligns with the <strong>LEFT</strong> vs.{" "}
              <strong>RIGHT</strong> position <em>on the specific issue shown</em>
              {" "}— always use the LEFT/RIGHT anchors we give you, not political
              stereotypes. −5 = maximal LEFT, 0 = genuinely neutral, +5 = maximal
              RIGHT. <strong>Use the whole scale</strong> — a mild lean is ±1, not
              ±3. Most talk isn&apos;t extreme; if you&apos;re mostly using ±5,
              recalibrate.
            </p>
          </div>
          <div>
            <div className="font-semibold text-gray-900">Intensity (1…5)</div>
            <p className="mt-1">
              How strongly it&apos;s expressed — 1 = passing remark, 5 = the
              passionate central argument. Independent of sentiment: a passing
              remark can be hard-left (−5, intensity 1).
            </p>
          </div>
          <div>
            <div className="font-semibold text-gray-900">Confidence (1…3)</div>
            <p className="mt-1">
              1 = guessing, 2 = reasonably sure, 3 = very confident.
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
            <div className="text-xs uppercase tracking-wider text-gray-500 font-medium">
              Calibration examples
            </div>
            <p>
              <span className="text-gray-500">Immigration, “…border is fine…
              destroying wages of working-class Americans.”</span>{" "}
              → <strong>+4</strong>, intensity 3 (strong R, deliberate).
            </p>
            <p>
              <span className="text-gray-500">Free speech, “…once you give
              platforms power to decide what&apos;s true, they&apos;ll abuse
              it.”</span>{" "}
              → <strong>+3</strong>, intensity 3 (strong R, acknowledges the L
              concern).
            </p>
            <p>
              <span className="text-gray-500">Trump/GOP, “lots to criticize on
              tariffs, but not the disaster the media claims.”</span>{" "}
              → <strong>+1</strong>, intensity 2 (mild R, qualified).
            </p>
          </div>
          <ul className="list-disc pl-5 space-y-1 text-gray-600">
            <li>Score only what&apos;s in the quote. If you can&apos;t tell, score 0 and lower confidence.</li>
            <li>Sarcasm / quoting an opponent: score what they actually mean.</li>
            <li>If the quote seems mis-filed under its issue, note it and score 0.</li>
            <li>Don&apos;t revisit earlier answers — we want fresh judgment per quote.</li>
          </ul>
        </div>

        <div className="mt-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Your name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Jordan Lee"
            className="max-w-xs"
          />
          <p className="text-xs text-gray-500 mt-1">
            Used only to save and resume your answers.
          </p>
        </div>

        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

        <Button className="mt-5" onClick={handleStart} disabled={busy}>
          {busy ? "Loading…" : "Start labeling"}
        </Button>
      </div>
    );
  }

  // ── Done ─────────────────────────────────────────────────────────────────
  if (phase === "done" || !current) {
    return (
      <div className="text-center py-16">
        <h1 className="text-2xl font-semibold tracking-tight">All done — thank you!</h1>
        <p className="text-gray-600 mt-3">
          You&apos;ve scored {doneCount} of {total} items. Your responses are
          saved. You can close this tab.
        </p>
      </div>
    );
  }

  // ── Labeling ───────────────────────────────────────────────────────────────
  const progressPct = total ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div>
      {/* Progress */}
      <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
        <span>
          Item {doneCount + 1} of {total}
        </span>
        <span className="tabular-nums">{progressPct}% complete</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-200 mb-6">
        <div
          className="h-1.5 rounded-full bg-gray-900 transition-all"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Item context */}
      <div className="text-xs text-gray-500 flex items-center gap-2">
        <span>{leanSource(current.channel_lean)}</span>
        {current.episode_date && (
          <>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{current.episode_date}</span>
          </>
        )}
      </div>
      <div className="mt-1 text-sm font-semibold text-gray-900">
        Issue: {current.issue_name}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md border border-blue-200 bg-blue-50 p-2">
          <span className="font-semibold text-blue-800">LEFT (−)</span>
          <div className="text-gray-700 mt-0.5">{current.issue_left_position}</div>
        </div>
        <div className="rounded-md border border-red-200 bg-red-50 p-2">
          <span className="font-semibold text-red-800">RIGHT (+)</span>
          <div className="text-gray-700 mt-0.5">{current.issue_right_position}</div>
        </div>
      </div>

      <blockquote className="mt-4 border-l-4 border-gray-300 pl-4 py-1 text-gray-900 leading-relaxed">
        “{current.quote}”
      </blockquote>

      {/* Inputs */}
      <div className="mt-6 space-y-5">
        <div>
          <div className="flex items-baseline justify-between">
            <label className="text-sm font-medium text-gray-700">Sentiment</label>
            <span className="text-[11px] text-gray-400">−5 Left · 0 neutral · +5 Right</span>
          </div>
          <div className="mt-1.5">
            <Segmented
              values={SENTIMENT_VALUES}
              value={sentiment}
              onChange={setSentiment}
              format={(v) => (v > 0 ? `+${v}` : String(v))}
              ariaLabel="Sentiment score"
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700">Intensity</label>
          <span className="text-[11px] text-gray-400 ml-2">1 passing · 5 central argument</span>
          <div className="mt-1.5">
            <Segmented
              values={INTENSITY_VALUES}
              value={intensity}
              onChange={setIntensity}
              ariaLabel="Intensity score"
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700">Confidence</label>
          <span className="text-[11px] text-gray-400 ml-2">1 guessing · 3 very confident</span>
          <div className="mt-1.5">
            <Segmented
              values={CONFIDENCE_VALUES}
              value={confidence}
              onChange={setConfidence}
              ariaLabel="Confidence"
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700">
            Notes <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Only if something was ambiguous or seemed mis-filed."
            className="mt-1.5 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

      <div className="mt-5">
        <Button onClick={handleSubmit} disabled={busy}>
          {busy ? "Saving…" : doneCount + 1 >= total ? "Submit & finish" : "Submit & next"}
        </Button>
      </div>
    </div>
  );
}
