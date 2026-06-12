"use client";

/**
 * A read-only value (URL, code snippet, or prompt) shown alongside a copy
 * button. Composes the shadcn Button primitive; `mono` toggles code styling vs
 * plain prose (e.g. example prompts).
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function CopyField({
  value,
  label,
  mono = true,
}: {
  value: string;
  label?: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked - the value is still selectable */
    }
  };

  return (
    <div className="flex items-stretch gap-2">
      <div
        className={
          "flex-1 min-w-0 p-3 bg-subtle border border-border rounded-md overflow-x-auto " +
          (mono
            ? "font-mono text-xs text-ink-strong whitespace-pre-wrap break-all leading-relaxed"
            : "text-sm text-ink-body leading-relaxed")
        }
      >
        {value}
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={copy}
        aria-label={label ? `Copy ${label}` : "Copy"}
        className="shrink-0 h-auto px-3 text-xs"
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
