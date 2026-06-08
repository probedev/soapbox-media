import { DonationWidget } from "@/components/DonationWidget";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";

export interface SupportVariant {
  lean: string; // "", "left", "middle", "right"
  eyebrow: string;
  headline: React.ReactNode;
  pitch: string;
}

/** Wikipedia-style "fund the referee" support page. The L/M/R variants reframe
 *  the same ask for donors who already give to candidates across the map. */
export function SupportLanding({ v }: { v: SupportVariant }) {
  return (
    <main className="min-h-screen">
      <Header />
      <section className="px-6 pt-12 pb-16 max-w-3xl mx-auto">
        <p className="text-xs font-mono uppercase tracking-widest text-gray-400">{v.eyebrow}</p>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight mt-2">{v.headline}</h1>
        <p className="text-gray-600 mt-4 leading-relaxed">{v.pitch}</p>

        <div className="grid md:grid-cols-2 gap-8 mt-8 items-start">
          <div className="space-y-4 text-gray-700 text-sm leading-relaxed">
            <p>
              Soapbox measures what high-reach political podcasts and YouTube shows are actually
              saying about the issues — left, center, and right, scored the same way. It&apos;s a
              neutral scoreboard for the conversation that drives our politics.
            </p>
            <p>
              Keeping it independent and free to read costs real money: transcription, classification,
              and scoring run every day across the whole panel. Reader support keeps the measurement
              honest and un-beholden.
            </p>
            <p className="text-gray-500">
              You fund candidates because outcomes matter. Fund the referee because a shared,
              trustworthy picture of what&apos;s being said matters too.
            </p>
          </div>
          <DonationWidget lean={v.lean} />
        </div>

        <p className="text-xs text-gray-400 mt-10">
          Contributions support Soapbox.media (Breakfastball LLC) and its operations. This is not a
          political contribution to any candidate or committee, and it is not tax-deductible.
        </p>
      </section>
      <Footer />
    </main>
  );
}

export const SUPPORT_VARIANTS: Record<string, SupportVariant> = {
  "": {
    lean: "",
    eyebrow: "Support Soapbox",
    headline: "Fund media transparency for democracy.",
    pitch:
      "Soapbox is independent, neutral measurement of what political media is saying. Small-dollar support keeps it running and free to read.",
  },
  left: {
    lean: "left",
    eyebrow: "Support Soapbox",
    headline: "You fund Democrats across the map. Fund the referee too.",
    pitch:
      "If you chip in to candidates outside your district, you already believe the national conversation matters. Soapbox measures that conversation neutrally — left, center, and right on the same scale. Keep the scoreboard independent.",
  },
  middle: {
    lean: "middle",
    eyebrow: "Support Soapbox",
    headline: "You give across the aisle. Fund the neutral measurement.",
    pitch:
      "Persuadable voters need a shared, trustworthy picture of what each side is actually saying. Soapbox is that measurement — no thumb on the scale. Reader support keeps it that way.",
  },
  right: {
    lean: "right",
    eyebrow: "Support Soapbox",
    headline: "You back conservatives coast to coast. Back the scoreboard.",
    pitch:
      "If you support candidates beyond your own race, the national narrative matters to you. Soapbox measures that narrative the same way for everyone — left, center, and right. Help keep the referee independent.",
  },
};
