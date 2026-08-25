import "./_load-env";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  const { data: latest } = await db.from("episodes")
    .select("created_at, published_at, transcript_status, classify_status")
    .order("created_at", { ascending: false }).limit(5);
  console.log("=== 5 newest episodes (created_at) ===");
  latest?.forEach(r => console.log(r.created_at, "| pub", r.published_at, "|", r.transcript_status, "/", r.classify_status));

  const { count: julyPlus } = await db.from("episodes")
    .select("*", { count: "exact", head: true }).gte("created_at", "2026-07-01");
  console.log("\nepisodes created since 2026-07-01:", julyPlus);

  const { count: lateJune } = await db.from("episodes")
    .select("*", { count: "exact", head: true }).gte("created_at", "2026-06-27").lt("created_at", "2026-07-01");
  console.log("episodes created 06-27..06-30:", lateJune);

  console.log("\n=== last 25 usage_log runs ===");
  const { data: runs } = await db.from("usage_log")
    .select("ran_at, source, duration_ms, ingest_episodes_new, ingest_failures, transcribe_succeeded, transcribe_failed, classify_processed, classify_failures, score_succeeded, score_failed, error_message")
    .order("ran_at", { ascending: false }).limit(25);
  runs?.forEach(r => console.log(
    r.ran_at, r.source.padEnd(14), `${r.duration_ms}ms`,
    "new:", r.ingest_episodes_new, "tr:", `${r.transcribe_succeeded}/${r.transcribe_failed}`,
    "cl:", `${r.classify_processed}/${r.classify_failures}`,
    "sc:", `${r.score_succeeded}/${r.score_failed}`,
    r.error_message ? "ERR: " + String(r.error_message).slice(0, 120) : ""
  ));

  console.log("\n=== last ingest-source runs ===");
  const { data: ing } = await db.from("usage_log")
    .select("ran_at, source, ingest_episodes_fetched, ingest_episodes_new, ingest_failures, error_message, raw_summary")
    .in("source", ["ingest", "cron:ingest", "cron-ingest"])
    .order("ran_at", { ascending: false }).limit(8);
  ing?.forEach(r => console.log(JSON.stringify(r).slice(0, 400)));
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
