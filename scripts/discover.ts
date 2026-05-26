/**
 * Rebuild emerging-issue discovery candidates from harvested off-taxonomy
 * topics. Clusters recent discovery_topics into candidate themes for review at
 * /admin/discovery. Human-gated — never edits the taxonomy.
 *
 * Run with:  npm run discover
 * Override:  npm run discover -- <window-days>   (default 21)
 */
import "./_load-env";

import { buildDiscoveryCandidates } from "@/lib/discovery";

async function main() {
  const windowDays = parseInt(process.argv[2] || "21", 10);
  console.log(`\nSoapbox discover — clustering off-taxonomy topics (last ${windowDays}d)`);
  console.log("─".repeat(60));

  const r = await buildDiscoveryCandidates(windowDays);
  console.log(`Topics considered:  ${r.topicsConsidered}`);
  console.log(`Candidates created: ${r.candidatesCreated}`);
  const cost = (r.inputTokens * 1) / 1_000_000 + (r.outputTokens * 5) / 1_000_000;
  console.log(`Tokens — in ${r.inputTokens.toLocaleString()}, out ${r.outputTokens.toLocaleString()} (~$${cost.toFixed(4)})`);
  console.log(`\nReview at /admin/discovery.`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
