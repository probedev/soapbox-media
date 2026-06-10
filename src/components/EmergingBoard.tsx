"use client";

/**
 * EmergingBoard - the /emerging page body: a cohort tab switcher (All /
 * Independent / Legacy) over the EmergingIssuesTable. Each cohort cut is
 * recomputed server-side (see getEmergingBoard), so the table, ranks, and counts
 * are correct per tab; the active cohort also flows into the receipts fetch so an
 * expanded row shows that cohort's quotes. Each tab renders its own table so
 * switching tabs resets row expansion.
 */
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmergingIssuesTable } from "@/components/EmergingIssuesTable";
import { formatDateET } from "@/lib/utils";
import type { EmergingIssue } from "@/lib/discovery";

function formatUpdated(iso: string): string {
  return formatDateET(iso, { month: "short", day: "numeric", year: "numeric" });
}

function TabContent({
  data,
  cohort,
}: {
  data: EmergingIssue[];
  cohort?: "independent" | "legacy";
}) {
  if (data.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic py-8">
        No emerging issues in this cohort right now.
      </div>
    );
  }
  return <EmergingIssuesTable data={data} cohort={cohort} />;
}

export function EmergingBoard({
  all,
  independent,
  legacy,
  lastUpdated,
}: {
  all: EmergingIssue[];
  independent: EmergingIssue[];
  legacy: EmergingIssue[];
  lastUpdated: string | null;
}) {
  return (
    <Tabs defaultValue="all">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <TabsList>
          <TabsTrigger value="all">
            All
            <span className="ml-1.5 tabular-nums text-xs opacity-70">{all.length}</span>
          </TabsTrigger>
          <TabsTrigger value="independent">
            Independent
            <span className="ml-1.5 tabular-nums text-xs opacity-70">{independent.length}</span>
          </TabsTrigger>
          <TabsTrigger value="legacy">
            Legacy
            <span className="ml-1.5 tabular-nums text-xs opacity-70">{legacy.length}</span>
          </TabsTrigger>
        </TabsList>
        {lastUpdated && (
          <Badge variant="outline" className="font-normal text-muted-foreground">
            Updated {formatUpdated(lastUpdated)}
          </Badge>
        )}
      </div>

      <TabsContent value="all">
        <TabContent data={all} />
      </TabsContent>
      <TabsContent value="independent">
        <TabContent data={independent} cohort="independent" />
      </TabsContent>
      <TabsContent value="legacy">
        <TabContent data={legacy} cohort="legacy" />
      </TabsContent>
    </Tabs>
  );
}
