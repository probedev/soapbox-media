/**
 * Data composition for the homelab2 staging dashboard (/admin/homelab2). Reuses
 * existing aggregators - NO new DB tables. Performance matters even on a staging
 * page: the naive version (getDashboardData x3 + getIndexBreakdown + getHomelabData
 * + getEmergingBoard, ~6 independent deep-join pulls) ran ~200s locally and would
 * risk the page's function timeout. So the home-derived data (master index,
 * sparkline, issues, movers, breakdown) comes from the PRECOMPUTED snapshot
 * (readHomeSnapshot, sub-100ms), and the cohort trends reuse getHomelabData's
 * twoConv series instead of two more live pulls. That leaves two heavy reads:
 * getHomelabData (one 90-day pass for the lab panels) + getEmergingBoard.
 *
 * Promoting any panel to the public home is still a separate step (its aggregates
 * go into writeHomeSnapshot); this composer just leans on the same snapshot.
 */
import {
  getDashboardData,
  getIndexBreakdown,
  readHomeSnapshot,
  type IssueAggregate,
  type IssueMover,
  type IssueContribution,
} from "@/lib/aggregate";
import {
  getHomelabData,
  type Pulse,
  type GapRow,
  type TwoConvPoint,
  type OwnershipPoint,
  type MegaphoneNode,
  type RiserRow,
  type HeatRow,
  type CrossTalkRow,
} from "@/lib/homelab";
import { getEmergingBoard, type EmergingIssue } from "@/lib/discovery";

export interface CohortTrend {
  index: number;
  sparkline: number[];
  dates: string[];
}

export interface Homelab2Data {
  index: number;
  indexDelta: number;
  masterSparkline: number[];
  masterDates: string[];
  cohorts: { independent: CohortTrend; legacy: CohortTrend };
  breakdown: IssueContribution[];
  topIssues: IssueAggregate[];
  movers: IssueMover[];
  gap: GapRow[];
  twoConv: TwoConvPoint[];
  ownership: OwnershipPoint[];
  megaphone: MegaphoneNode[];
  risers: RiserRow[];
  pulse: Pulse;
  heat: { issues: HeatRow[]; weekLabels: string[] };
  crossTalk: CrossTalkRow[];
  breaking: EmergingIssue[];
  stats: { channels: number; episodes: number; mentions: number };
}

/** Cohort index trend (independent or legacy) reused from getHomelabData's
 *  twoConv series - avoids two extra per-cohort deep-join pulls. */
function cohortTrend(twoConv: TwoConvPoint[], key: "independent" | "legacy", snapIndex?: number): CohortTrend {
  const pts = twoConv.filter((p) => p[key] != null);
  const sparkline = pts.map((p) => p[key] as number);
  return {
    index: snapIndex ?? (sparkline.length ? sparkline[sparkline.length - 1] : 0),
    sparkline,
    dates: pts.map((p) => p.date),
  };
}

export async function getHomelab2Data(): Promise<Homelab2Data> {
  const [snap, lab, board] = await Promise.all([
    readHomeSnapshot(7),
    getHomelabData(),
    getEmergingBoard(),
  ]);

  // Home-derived data from the precomputed snapshot; live fallback only if the
  // snapshot hasn't been written yet (e.g. right after first deploy).
  let dashboard = snap?.dashboard;
  let breakdown = snap?.breakdown.issues;
  if (!dashboard || !breakdown) {
    const [dd, bd] = await Promise.all([getDashboardData(7), getIndexBreakdown(7)]);
    dashboard = dd;
    breakdown = bd.issues;
  }

  return {
    index: dashboard.index,
    indexDelta: dashboard.delta,
    masterSparkline: dashboard.sparkline,
    masterDates: dashboard.sparklineDates,
    cohorts: {
      independent: cohortTrend(lab.twoConv, "independent", snap?.cohorts?.independent.index),
      legacy: cohortTrend(lab.twoConv, "legacy", snap?.cohorts?.legacy.index),
    },
    breakdown,
    topIssues: dashboard.issues,
    movers: dashboard.movers,
    gap: lab.gap,
    twoConv: lab.twoConv,
    ownership: lab.ownership,
    megaphone: lab.megaphone,
    risers: lab.risers,
    pulse: lab.pulse,
    heat: lab.heat,
    crossTalk: lab.crossTalk,
    breaking: board.all.slice(0, 5),
    stats: {
      channels: dashboard.numChannels,
      episodes: dashboard.numEpisodes,
      mentions: dashboard.numClassifications,
    },
  };
}
