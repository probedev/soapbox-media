"use client";

import { useState } from "react";

/**
 * Click-to-copy color swatch for the brand page. Client component so the hex
 * lands on the clipboard with one tap (designers live in this page). Display
 * stays graceful if the Clipboard API is unavailable: the hex is still shown
 * and selectable.
 */
export function Swatch({
  name,
  hex,
  note,
}: {
  name: string;
  hex: string;
  note?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      title={`Copy ${hex.toUpperCase()}`}
      onClick={() => {
        navigator.clipboard
          ?.writeText(hex.toUpperCase())
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          })
          .catch(() => {});
      }}
      className="group block w-full text-left rounded-md border border-border overflow-hidden transition hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="h-16 w-full" style={{ backgroundColor: hex }} />
      <div className="p-3">
        <div className="text-sm font-medium text-ink-strong">{name}</div>
        <div className="mt-0.5 flex items-center gap-1.5 font-mono text-xs text-ink-muted tabular-nums">
          <span>{hex.toUpperCase()}</span>
          <span className="text-ink-faint transition group-hover:text-ink-body">
            {copied ? "copied" : "copy"}
          </span>
        </div>
        {note ? (
          <div className="mt-1 text-xs leading-snug text-ink-faint">{note}</div>
        ) : null}
      </div>
    </button>
  );
}
