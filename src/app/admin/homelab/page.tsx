/**
 * /admin/homelab - private mock-up of all 14 candidate home-page cards
 * against LIVE data, grouped by proposed zone, so the v1 cut and ordering
 * can be decided by looking. Behind admin Basic Auth like all /admin/*.
 *
 * Deliberately heavy (one 90-day pull + quote scans, ~10s) - this is a
 * decision tool, not the production data path. Chosen cards get
 * snapshot-backed implementations.
 */
import { AdminNav } from "@/components/AdminNav";
import {
  BattlefieldCard, CrossTalkCard, FusesCard, GapCard, HeatGridCard, LabCard,
  MegaphoneCard, OwnershipCard, PlatformSplitCard, PolarizationCard,
  PulseCard, ReceiptsCard, RisersCard, StripsCard, TwoConvCard,
} from "@/components/homelab/HomelabCards";
import { getHomelabData } from "@/lib/homelab";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function Zone({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xs font-mono uppercase tracking-widest text-gray-400 mb-4">{title}</h2>
      {children}
    </section>
  );
}

export default async function HomelabPage() {
  const d = await getHomelabData();

  return (
    <main className="min-h-screen bg-gray-50">
      <AdminNav />
      <div className="max-w-6xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Home page lab</h1>
        <p className="text-sm text-gray-500 mt-2 max-w-2xl">
          All 14 candidate cards rendered from live data ({d.rowCount.toLocaleString()} scored mentions,
          90-day pull). Pick the v1 cut and ordering; chosen cards get snapshot-backed production
          implementations. Zones mirror the proposed home-page information architecture.
        </p>

        <Zone title="Zone 2 · The Pulse">
          <div className="grid md:grid-cols-2 gap-5">
            <LabCard n={1} title="The Pulse" hook="GA-style scale proof - how much signal sits behind every number. (Everyone)">
              <PulseCard d={d.pulse} />
            </LabCard>
            <LabCard n={13} title="The Polarization Strip" hook="The shape of the conversation itself - the bimodal valley is the finding. (Pollsters, academics)">
              <PolarizationCard {...d.polarization} />
            </LabCard>
          </div>
        </Zone>

        <Zone title="Zone 3 · What's Moving">
          <div className="grid md:grid-cols-2 gap-5">
            <LabCard n={9} title="Lit Fuses" hook="Volume acceleration - what's about to matter, before it shows in tracking polls. (Pollsters, comms)">
              <FusesCard d={d.fuses} />
            </LabCard>
            <LabCard n={7} title="Risers & Faders" hook="Named shows surging or fading in share-of-voice, with lean drift. (Media buyers)">
              <RisersCard d={d.risers} />
            </LabCard>
          </div>
        </Zone>

        <Zone title="Zone 4 · The Issues">
          <div className="grid md:grid-cols-2 gap-5">
            <LabCard n={2} title="The Battlefield" hook="Contested vs owned - weighted L/R share per issue. (Campaign managers)">
              <BattlefieldCard d={d.battlefield} />
            </LabCard>
            <LabCard n={3} title="Issue Heat Grid" hook="Eight weeks of salience at a glance - what's hot, fading, or flipping color. (Pollsters, comms)">
              <HeatGridCard issues={d.heat.issues} weekLabels={d.heat.weekLabels} />
            </LabCard>
            <LabCard n={4} title="Issue Ownership Map" hook="Loud-and-left, loud-and-right, or up for grabs - the strategy slide, free. (Consultants)">
              <OwnershipCard d={d.ownership} />
            </LabCard>
            <LabCard n={10} title="The Strips" hook="Every top issue's 30-day trajectory, election-night style. (Everyone)">
              <StripsCard d={d.strips} />
            </LabCard>
          </div>
        </Zone>

        <Zone title="Zone 5 · The Voices & The Two Worlds">
          <div className="grid md:grid-cols-2 gap-5">
            <LabCard n={8} title="The Megaphone Map" hook="The attention economy, sized by reach-weighted voice. (Media buyers)">
              <MegaphoneCard d={d.megaphone} />
            </LabCard>
            <LabCard n={5} title="The Gap" hook="Where alt-media diverges hardest from legacy - per issue. (Journalists, consultants)">
              <GapCard d={d.gap} />
            </LabCard>
            <LabCard n={6} title="Two Conversations" hook="Independent vs legacy index over 90 days - converging or splitting? (Consultants, journalists)">
              <TwoConvCard d={d.twoConv} />
            </LabCard>
            <LabCard n={14} title="Audio vs Video" hook="Does the same issue play differently on podcasts vs YouTube? (Media buyers)">
              <PlatformSplitCard d={d.platformSplit} />
            </LabCard>
          </div>
        </Zone>

        <Zone title="Zone 6 · The Receipts">
          <div className="grid md:grid-cols-2 gap-5">
            <LabCard n={11} title="Receipts" hook="The sharpest verbatim quotes of the week, with sources - proof the data is alive. (Journalists, war rooms)">
              <ReceiptsCard d={d.receipts} />
            </LabCard>
            <LabCard n={12} title="Cross-Talk" hook="Who's the main character this week - voices named by OTHER shows. (Comms, PR)">
              <CrossTalkCard d={d.crossTalk} />
            </LabCard>
          </div>
        </Zone>
      </div>
    </main>
  );
}
