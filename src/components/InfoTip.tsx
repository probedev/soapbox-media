"use client";

import * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Hover tooltip with the site's shadcn styling - the sanctioned replacement for
 * native `title=` browser hints (the project bans native tooltips where shadcn
 * exists). Relies on the app-wide TooltipProvider in the root layout.
 *
 * Wraps a single child element as the trigger (asChild, so the child keeps its
 * own className/style/positioning). For non-interactive triggers add
 * `cursor-default` / `tabIndex={0}` on the child as needed at the call site.
 */
export function InfoTip({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
