import type { ReactNode } from "react";
import Image from "next/image";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SoapboxNeedle } from "@/components/SoapboxNeedle";
import { Wordmark } from "@/components/Wordmark";
import { Swatch } from "./Swatch";
import logoCrate from "@/assets/logo-crate.png";
import { TAGLINE } from "@/lib/brand";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Brand Guidelines · Soapbox",
  description:
    "Soapbox brand assets, color, typography, and voice: logos, palette, type, and usage rules, all downloadable.",
};

/** Downloadable asset files (served from /public/brand). */
const DOWNLOADS = [
  { label: "Logo, PNG 1024px", sub: "Primary mark, transparent, master", href: "/brand/soapbox-logo-1024.png" },
  { label: "Logo, PNG 512px", sub: "Transparent, web and social", href: "/brand/soapbox-logo-512.png" },
  { label: "Icon, PNG 256px", sub: "Transparent, avatar and app icon", href: "/brand/soapbox-icon-256.png" },
  { label: "Favicon, ICO", sub: "Browser tab", href: "/brand/soapbox-favicon.ico" },
];

/** Brand wordmark colors (the lockup), distinct from the data palette. */
const BRAND_COLORS = [
  { name: "Soapbox Red", hex: "#C8202F", note: "The “soap” in the wordmark" },
  { name: "Soapbox Blue", hex: "#114A8A", note: "The “box” in the wordmark" },
];

/** Data / lean palette: semantic, used in every chart and gauge on the site. */
const DATA_COLORS = [
  { name: "Right", hex: "#DC2626", note: "Right-leaning" },
  { name: "Left", hex: "#2563EB", note: "Left-leaning" },
  { name: "Neutral", hex: "#6B7280", note: "Even / volume" },
  { name: "Index", hex: "#374151", note: "Composite Index line" },
  { name: "Muted", hex: "#9CA3AF", note: "Axes / references" },
];

/** Neutral ink ramp (Tailwind gray), the site's text and surface hierarchy. */
const NEUTRALS = [
  { name: "Background", hex: "#FFFFFF", note: "Page surface" },
  { name: "Foreground", hex: "#111827", note: "gray-900, headings" },
  { name: "Ink Body", hex: "#374151", note: "gray-700, body copy" },
  { name: "Ink Muted", hex: "#4B5563", note: "gray-600, secondary" },
  { name: "Ink Faint", hex: "#9CA3AF", note: "gray-400, captions" },
  { name: "Border", hex: "#E5E7EB", note: "gray-200, hairlines" },
  { name: "Subtle", hex: "#F9FAFB", note: "gray-50, zebra / hover" },
];

function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="text-xl font-semibold mt-16 scroll-mt-24">{children}</h2>;
}

export default function BrandPage() {
  return (
    <main className="min-h-screen">
      <Header />

      <section className="px-6 pt-10 pb-20 max-w-3xl mx-auto">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          Brand Guidelines
        </h1>
        <p className="text-ink-muted mt-3 leading-relaxed">
          Everything needed to represent Soapbox consistently: logo, color,
          type, and voice. Every asset on this page is downloadable. When in
          doubt, keep it plain and let the numbers speak: the brand is a
          measurement, not a megaphone.
        </p>

        {/* Quick downloads */}
        <SectionHeading>Download assets</SectionHeading>
        <p className="text-ink-body mt-3 leading-relaxed">
          Transparent PNGs at the sizes most uses need. The 1024px logo is the
          master; scale down from it, never up.
        </p>
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {DOWNLOADS.map((d) => (
            <Card key={d.href}>
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-subtle border border-border">
                  <Image
                    src={logoCrate}
                    alt=""
                    width={40}
                    height={40}
                    className="h-9 w-9 object-contain"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink-strong">{d.label}</div>
                  <div className="text-xs text-ink-faint leading-snug">{d.sub}</div>
                </div>
                <Button asChild variant="outline" size="sm">
                  <a href={d.href} download>
                    Download
                  </a>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Logo */}
        <SectionHeading>Logo</SectionHeading>
        <p className="text-ink-body mt-3 leading-relaxed">
          The mark is a wooden crate: the literal soapbox you stand on to be
          heard. It pairs with the lowercase wordmark{" "}
          <Wordmark className="text-base align-baseline" />, set in Protest Strike
          with the two-color split. Use the mark alone where space is tight
          (avatars, favicons) and the full lockup everywhere else.
        </p>

        {/* Primary lockup specimen, on light and dark */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-3 p-8">
              <div className="flex items-center gap-3">
                <Image src={logoCrate} alt="Soapbox logo" width={48} height={48} className="h-12 w-12 object-contain" />
                <Wordmark className="text-4xl" />
              </div>
              <span className="text-xs text-ink-faint">Full lockup on light</span>
            </CardContent>
          </Card>
          <Card className="border-0">
            <CardContent
              className="flex flex-col items-center justify-center gap-3 rounded-lg p-8"
              style={{ backgroundColor: "#111827" }}
            >
              <div className="flex items-center gap-3">
                <Image src={logoCrate} alt="Soapbox logo on dark" width={48} height={48} className="h-12 w-12 object-contain" />
                <Wordmark className="text-4xl" mono="#FFFFFF" />
              </div>
              <span className="text-xs" style={{ color: "#9CA3AF" }}>
                On dark, use the mark alone or set the wordmark in white
              </span>
            </CardContent>
          </Card>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-sm text-ink-muted">Download the wordmark:</span>
          <Button asChild variant="outline" size="sm">
            <a href="/brand/soapbox-wordmark.svg" download>SVG (vector)</a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href="/brand/soapbox-wordmark.png" download>PNG (transparent)</a>
          </Button>
        </div>
        <p className="mt-2 text-xs text-ink-faint leading-relaxed">
          The wordmark is a real asset: the SVG is outlined (no font needed), and
          the PNG is transparent. Use these rather than retyping &quot;soapbox&quot;
          in Geist yourself.
        </p>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
          <div>
            <h3 className="text-sm font-semibold text-ink-strong">Do</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-ink-body leading-relaxed list-disc pl-5">
              <li>Use the downloadable wordmark (SVG or PNG), do not retype it.</li>
              <li>Keep clear space around the mark of at least the crate&apos;s own height.</li>
              <li>Use the transparent PNG so it sits on any background.</li>
              <li>Scale the mark and wordmark together, proportionally.</li>
              <li>Minimum mark size 24px (favicon) or 32px in a header.</li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink-strong">Don&apos;t</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-ink-body leading-relaxed list-disc pl-5">
              <li>Recolor, outline, or add shadows to the crate.</li>
              <li>Stretch, skew, or rotate the mark.</li>
              <li>Place it on a busy image without a contrast plate.</li>
              <li>Rebuild the wordmark in a different typeface.</li>
            </ul>
          </div>
        </div>

        {/* The needle */}
        <SectionHeading>The needle</SectionHeading>
        <p className="text-ink-body mt-3 leading-relaxed">
          The Index needle is the signature visual of the product: a half-circle
          gauge from L 10 to R 10, the arc graded blue on the left through
          neutral to red on the right, with the needle resting at the current
          Soapbox Index. It carries the whole idea in one glance: one scale, one
          number. Keep blue on the left and red on the right, always.
        </p>
        <Card className="mt-5">
          <CardContent className="flex flex-col items-center gap-4 p-8">
            <div className="w-full max-w-[420px] [&>svg]:h-auto [&>svg]:w-full">
              <SoapboxNeedle value={2} />
            </div>
            <span className="text-xs text-ink-faint">
              Shown at R+2. The needle spans L 10 to R 10; rotate it to any value.
            </span>
            <Button asChild variant="outline" size="sm">
              <a href="/brand/soapbox-needle.svg" download>
                Download needle SVG
              </a>
            </Button>
          </CardContent>
        </Card>

        {/* Color */}
        <SectionHeading>Color</SectionHeading>
        <p className="text-ink-body mt-3 leading-relaxed">
          Two palettes, kept separate on purpose. The brand colors belong to the
          wordmark and identity. The data palette is semantic and never
          decorative: red is always right, blue is always left, gray is neutral.
          Click any swatch to copy its hex.
        </p>

        <h3 className="mt-6 text-sm font-semibold text-ink-strong">Brand</h3>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {BRAND_COLORS.map((c) => (
            <Swatch key={c.hex} name={c.name} hex={c.hex} note={c.note} />
          ))}
        </div>

        <h3 className="mt-8 text-sm font-semibold text-ink-strong">
          Data and lean (semantic)
        </h3>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {DATA_COLORS.map((c) => (
            <Swatch key={c.hex} name={c.name} hex={c.hex} note={c.note} />
          ))}
        </div>

        <h3 className="mt-8 text-sm font-semibold text-ink-strong">Neutrals</h3>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {NEUTRALS.map((c) => (
            <Swatch key={c.hex} name={c.name} hex={c.hex} note={c.note} />
          ))}
        </div>

        {/* Typography */}
        <SectionHeading>Typography</SectionHeading>
        <p className="text-ink-body mt-3 leading-relaxed">
          Two typefaces, each with one job. The wordmark is set in{" "}
          <a
            href="https://fonts.google.com/specimen/Protest+Strike"
            className="underline hover:text-foreground"
            target="_blank"
            rel="noopener noreferrer"
          >
            Protest Strike
          </a>{" "}
          (a heavy display face) and is used only for the logotype. Everything
          else, headings, body, and data, is{" "}
          <a
            href="https://vercel.com/font"
            className="underline hover:text-foreground"
            target="_blank"
            rel="noopener noreferrer"
          >
            Geist Sans
          </a>{" "}
          (also on Google Fonts as &quot;Geist&quot;). Numbers in any data context
          use tabular figures so columns line up.
        </p>
        <Card className="mt-5">
          <CardContent className="p-8 space-y-5">
            <div>
              <Wordmark className="text-5xl" />
              <div className="mt-2 text-xs text-ink-faint">Protest Strike, the wordmark only</div>
            </div>
            <div className="space-y-2 border-t border-border pt-5">
              <div className="text-2xl font-semibold tracking-tight">Geist Semibold, headings</div>
              <div className="text-base text-ink-body">Geist Regular, body copy and captions</div>
              <div className="font-mono text-sm text-ink-muted tabular-nums">
                Tabular figures: 0123456789 - L+3.2 / R+1.8
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Voice and copy */}
        <SectionHeading>Voice and copy</SectionHeading>
        <ul className="mt-3 space-y-3 text-ink-body leading-relaxed list-disc pl-5">
          <li>
            <strong>Name.</strong> Write &quot;Soapbox&quot; with one capital S in
            prose, and the domain as &quot;soapbox.media&quot;. The wordmark itself
            is stylized lowercase. Never &quot;SoapBox&quot; or &quot;Soap Box&quot;.
          </li>
          <li>
            <strong>Tagline.</strong> {TAGLINE}
          </li>
          <li>
            <strong>Tone.</strong> Factual and measured, with no hype near the
            math. The Index is a measurement, not an opinion. State what the data
            shows and link to the source.
          </li>
          <li>
            <strong>No em dashes.</strong> A hard rule across everything Soapbox
            publishes, captions included. Use commas, colons, parentheses, or a
            spaced hyphen ( - ) instead.
          </li>
          <li>
            <strong>Keep the color meaning.</strong> In any chart, slide, or
            graphic, red stays right and blue stays left. Do not swap them for
            visual variety.
          </li>
        </ul>

        {/* Social use */}
        <SectionHeading>Using the brand on social</SectionHeading>
        <p className="text-ink-body mt-3 leading-relaxed">
          For stat slides and carousels: lead with one clear number, set in Geist
          with tabular figures. Use the data palette for the data (red right, blue
          left, gray neutral) and the neutrals for everything else. Place the
          transparent crate or full lockup in a corner with clear space around it,
          and attribute with &quot;soapbox.media&quot;. Keep backgrounds simple so
          the number, not the decoration, is the message.
        </p>

        <p className="text-ink-faint text-sm mt-16 leading-relaxed">
          Need a format that is not here (vector, a one-color version, a specific
          social size)? Those can be produced from the master on request.
        </p>
      </section>

      <Footer />
    </main>
  );
}
