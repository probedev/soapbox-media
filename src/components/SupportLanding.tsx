import { DonationWidget } from "@/components/DonationWidget";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { SoapboxNeedle } from "@/components/SoapboxNeedle";
import { Card } from "@/components/ui/card";
import { readHomeSnapshot, getDashboardData } from "@/lib/aggregate";
import { Ban, Scale, Eye } from "lucide-react";

export interface SupportVariant {
  lean: string; // "", "left", "middle", "right"
  eyebrow: string;
  headline: React.ReactNode;
  /** One tailored opening line, in the second person. */
  pitch: string;
}

const VALUE_PROPS = [
  { icon: Ban, text: "No ads, no investors, no paywall" },
  { icon: Scale, text: "Left, center, and right on one scale" },
  { icon: Eye, text: "Free for anyone to read" },
] as const;

/**
 * Support appeal, conversion-tuned after the top political-donation landing
 * pages: one punchy headline + a single line, the ask placed high (first on
 * mobile, sticky on the right on desktop), and our own instrument - the live
 * Soapbox Index needle - as the on-brand hero visual (we're not a candidate, so
 * the gauge is the photo). The L/M/R variants supply targeted headlines for the
 * campaign's per-audience refcodes.
 */
export async function SupportLanding({ v }: { v: SupportVariant }) {
  const snapshot = await readHomeSnapshot().catch(() => null);
  const data = snapshot?.dashboard ?? (await getDashboardData(7).catch(() => null));
  const index = data?.index ?? 0;
  const hasData = data?.hasData ?? false;
  const dir = index >= 0 ? "R+" : "L+";
  const indexColor = index >= 0 ? "text-red-600" : "text-blue-600";

  return (
    <main className="min-h-screen">
      <Header />
      <section className="px-6 pt-10 pb-16 max-w-4xl mx-auto">
        <div className="text-center md:text-left">
          <p className="text-xs font-mono uppercase tracking-widest text-ink-faint">{v.eyebrow}</p>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight mt-2">{v.headline}</h1>
          <p className="text-ink-muted mt-3 text-base md:text-lg leading-relaxed max-w-2xl mx-auto md:mx-0">
            {v.pitch}
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 md:gap-12 mt-8 items-start">
          {/* The ask - first on mobile, sticky-right on desktop */}
          <div className="md:order-2 md:sticky md:top-8">
            <DonationWidget lean={v.lean} />
          </div>

          {/* The product itself, as the visual */}
          <div className="md:order-1">
            <Card className="p-5">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground text-center mb-1">
                What your support funds
              </div>
              <div className="flex justify-center">
                <SoapboxNeedle value={index} animated width={300} height={186} />
              </div>
              <div className="text-center -mt-2">
                {hasData ? (
                  <>
                    <span className={`text-2xl font-semibold tabular-nums ${indexColor}`}>
                      {dir}
                      {Math.abs(index).toFixed(1)}
                    </span>
                    <span className="text-xs text-ink-faint ml-2">today&apos;s Soapbox Index</span>
                  </>
                ) : (
                  <span className="text-sm text-ink-faint">the Soapbox Index</span>
                )}
              </div>
              <p className="text-xs text-ink-muted text-center mt-3 leading-snug">
                One needle, updated daily: what the highest-reach political voices are saying, across
                left, center, and right, scored the same way and free for anyone to read.
              </p>
            </Card>

            <ul className="mt-5 space-y-2.5">
              {VALUE_PROPS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-2.5 text-sm text-ink-body">
                  <Icon className="w-4 h-4 text-ink-faint shrink-0" />
                  {text}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="text-xs text-ink-faint mt-10 text-center md:text-left">
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
      "Soapbox is reader-supported, neutral measurement of what political media is really saying - and it stays that way only with help from people like you.",
  },
  left: {
    lean: "left",
    eyebrow: "Support our work",
    headline: "You fund Democrats across the map. Fund the referee too.",
    pitch:
      "If you chip in to candidates beyond your own district, you already believe the national conversation matters. Soapbox measures it neutrally - left, center, and right on one scale.",
  },
  middle: {
    lean: "middle",
    eyebrow: "Support our work",
    headline: "You give across the aisle. Fund the neutral measurement.",
    pitch:
      "Persuadable voters need a shared, trustworthy picture of what each side is actually saying. Soapbox is that picture - no thumb on the scale.",
  },
  right: {
    lean: "right",
    eyebrow: "Support our work",
    headline: "You back conservatives coast to coast. Back the scoreboard.",
    pitch:
      "If you support candidates beyond your own race, the national narrative matters to you. Soapbox measures it the same way for everyone - left, center, and right.",
  },
};
