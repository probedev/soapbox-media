import "./_load-env";
import {
  getIssueDrillDown, getTopicDrillDown, getChannelDrillDown,
  getIssueMovementBreakdown, getFiguresOverview, getFigureDetail,
} from "@/lib/aggregate";
import { createServiceClient } from "@/lib/db";

async function timeIt<T>(label: string, fn: () => Promise<T>, summarize: (r: T) => string) {
  const t0 = Date.now();
  try {
    const r = await fn();
    console.log(`${label}: ${((Date.now() - t0) / 1000).toFixed(1)}s - ${summarize(r)}`);
  } catch (e) {
    console.log(`${label}: FAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s - ${e instanceof Error ? e.message : e}`);
  }
}

async function main() {
  const db = createServiceClient();
  const { data: ch } = await db.from("channels").select("id, name").eq("active", true).limit(1).single();
  const { data: fig } = await db.from("figures").select("slug").eq("active", true).limit(1).single();
  const { data: topic } = await db.from("issues").select("topic_slug").not("topic_slug", "is", null).limit(1).single();

  await timeIt("issueDrillDown(immigration)", () => getIssueDrillDown("immigration"),
    r => r ? `${r.channels.length} channels` : "null");
  await timeIt(`channelDrillDown(${ch?.name})`, () => getChannelDrillDown(ch!.id),
    r => r ? `${r.issues.length} issues` : "null");
  await timeIt(`topicDrillDown(${topic?.topic_slug})`, () => getTopicDrillDown(topic!.topic_slug),
    r => r ? `${r.issues.length} issues` : "null");
  await timeIt("issueMovementBreakdown(immigration)", () => getIssueMovementBreakdown("immigration", 7),
    r => r ? `${r.shows.length} shows, ${r.mentions} mentions` : "null");
  await timeIt("figuresOverview()", () => getFiguresOverview(),
    r => `${r.length} figures, top=${r[0]?.slug} (${r[0]?.mentions})`);
  await timeIt(`figureDetail(${fig?.slug})`, () => getFigureDetail(fig!.slug),
    r => r ? `${r.mentions} mentions` : "null");
}
main();
