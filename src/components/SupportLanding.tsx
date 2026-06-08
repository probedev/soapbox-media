import { DonationWidget } from "@/components/DonationWidget";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";

export interface SupportVariant {
  lean: string; // "", "left", "middle", "right"
  eyebrow: string;
  headline: React.ReactNode;
  /** One tailored opening line, in the second person. */
  pitch: string;
}

/**
 * Wikipedia-style support appeal — reflective, personal, second-person. The
 * L/M/R variants supply the headline + opening line for donors who already
 * give to candidates across the map ("fund the referee"); the body appeal is
 * shared.
 */
export function SupportLanding({ v }: { v: SupportVariant }) {
  return (
    <main className="min-h-screen">
      <Header />
      <section className="px-6 pt-12 pb-16 max-w-3xl mx-auto">
        <p className="text-xs font-mono uppercase tracking-widest text-gray-400">{v.eyebrow}</p>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight mt-2">{v.headline}</h1>

        <div className="grid md:grid-cols-2 gap-10 mt-8 items-start">
          {/* The appeal */}
          <div className="space-y-4 text-gray-700 leading-relaxed">
            <p className="text-gray-800">{v.pitch}</p>
            <p>
              Think back over this past year of politics — the speeches, the podcasts, the clips that
              raced across your feed. How often did you want a straight answer to a simple question:
              <em> what is political media actually saying?</em> Not the spin about the spin — the
              measurement. Soapbox exists to give you that.
            </p>
            <p>
              The promise of an informed public — a shared, honest picture of the debate — is under
              constant strain. Outrage travels faster than fact, and most of what shapes our politics
              is never measured at all. Every day, Soapbox measures it anyway: the highest-reach
              voices across left, center, and right, scored the same way, and free for anyone to read.
            </p>
            <p>
              We take no side and sell no coverage. That independence is exactly what your
              contribution protects. If Soapbox has given you a clearer view this year, please join
              the readers who keep it running — <strong>$5, $20, $50, or whatever feels right
              today.</strong> There are no small contributions; every reader who chips in keeps the
              scoreboard honest.
            </p>
            <p className="text-gray-900 font-medium">Thank you.</p>
          </div>

          {/* The ask */}
          <div className="md:sticky md:top-8">
            <DonationWidget lean={v.lean} />
          </div>
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
    eyebrow: "Support our work",
    headline: "Keep the scoreboard honest.",
    pitch:
      "Soapbox is reader-supported, independent measurement of what political media is really saying — and it only stays that way with help from people like you.",
  },
  left: {
    lean: "left",
    eyebrow: "Support our work",
    headline: "You fund Democrats across the map. Fund the referee too.",
    pitch:
      "If you chip in to candidates beyond your own district, you already believe the national conversation matters. Soapbox measures that conversation neutrally — left, center, and right on one scale.",
  },
  middle: {
    lean: "middle",
    eyebrow: "Support our work",
    headline: "You give across the aisle. Fund the neutral measurement.",
    pitch:
      "Persuadable voters need a shared, trustworthy picture of what each side is actually saying. Soapbox is that picture — no thumb on the scale.",
  },
  right: {
    lean: "right",
    eyebrow: "Support our work",
    headline: "You back conservatives coast to coast. Back the scoreboard.",
    pitch:
      "If you support candidates beyond your own race, the national narrative matters to you. Soapbox measures that narrative the same way for everyone — left, center, and right.",
  },
};
