/**
 * Dynamic Open Graph image for the home page.
 *
 * Renders a 1200×630 PNG showing the live Soapbox Index value, a needle
 * bar, the tagline, and basic system stats. Every time the URL is shared
 * the preview reflects the current state of the dataset — that's the
 * whole point of doing this dynamically rather than as a static asset.
 *
 * Auto-detected by Next.js App Router. The metadata in `layout.tsx`
 * references the same image for Twitter cards via `summary_large_image`.
 *
 * Runtime: nodejs (not edge). The Index calculation reads all sentiment
 * scores via `getDashboardData`, which can pull several thousand rows
 * with deep joins. Edge runtime's memory ceiling is tight and Vercel
 * caches OG images per-URL anyway, so cold-start cost is amortized.
 */
import { ImageResponse } from "next/og";
import { getDashboardData } from "@/lib/aggregate";

export const runtime = "nodejs";
export const revalidate = 3600; // re-generate at most once per hour

export const alt = "Soapbox · Alternative media discourse, quantified";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function formatAsOf(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function OpengraphImage() {
  // Best-effort fetch — if it fails (e.g. cold DB), we still render a
  // sensible fallback rather than 500ing the OG endpoint.
  let data: Awaited<ReturnType<typeof getDashboardData>>;
  try {
    data = await getDashboardData(7);
  } catch {
    // Fallback shape
    data = {
      asOfDate: new Date().toISOString().slice(0, 10),
      windowDays: 7,
      index: 0,
      delta: 0,
      sparkline: [],
      issues: [],
      movers: [],
      numChannels: 0,
      numEpisodes: 0,
      numClassifications: 0,
      lastUpdated: new Date().toISOString(),
      hasData: false,
    };
  }

  const indexAbs = Math.abs(data.index);
  const indexColor =
    data.index > 0.05 ? "#C8202F" : data.index < -0.05 ? "#114A8A" : "#374151";
  const directionLabel =
    data.index > 0.05 ? "R+" : data.index < -0.05 ? "L+" : "";
  const formattedNumber = directionLabel + indexAbs.toFixed(1);

  // Needle position: map index from [-10, +10] to [0%, 100%]
  const needlePct = Math.max(0, Math.min(100, (data.index + 10) * 5));

  const asOfFormatted = formatAsOf(data.asOfDate);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#ffffff",
          padding: "70px 90px",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        {/* Top: wordmark */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <span
            style={{
              fontSize: 56,
              fontWeight: 900,
              letterSpacing: "-0.03em",
              lineHeight: 1,
              display: "flex",
            }}
          >
            <span style={{ color: "#C8202F" }}>soap</span>
            <span style={{ color: "#114A8A" }}>box</span>
          </span>
        </div>

        {/* Hero: Index value */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            flex: 1,
            justifyContent: "center",
            marginTop: 20,
          }}
        >
          <div
            style={{
              fontSize: 20,
              color: "#6b7280",
              textTransform: "uppercase",
              letterSpacing: "0.18em",
              marginBottom: 16,
              fontWeight: 600,
              display: "flex",
            }}
          >
            The Soapbox Index · last 7 days
          </div>
          <div
            style={{
              fontSize: 220,
              fontWeight: 700,
              letterSpacing: "-0.04em",
              color: indexColor,
              lineHeight: 1,
              display: "flex",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {data.hasData ? formattedNumber : "—"}
          </div>

          {/* Needle bar */}
          {data.hasData && (
            <div
              style={{
                position: "relative",
                width: 760,
                height: 14,
                marginTop: 40,
                borderRadius: 7,
                background:
                  "linear-gradient(to right, #3b82f6 0%, #e5e7eb 50%, #ef4444 100%)",
                display: "flex",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: `${needlePct}%`,
                  top: -10,
                  width: 4,
                  height: 34,
                  background: "#111827",
                  borderRadius: 2,
                  transform: "translateX(-2px)",
                  display: "flex",
                }}
              />
            </div>
          )}

          {data.hasData && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                width: 760,
                marginTop: 12,
                fontSize: 14,
                color: "#9ca3af",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              <span>Left</span>
              <span>0</span>
              <span>Right</span>
            </div>
          )}
        </div>

        {/* Bottom: tagline + stats */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 30,
              color: "#1f2937",
              fontWeight: 500,
              marginBottom: 14,
              display: "flex",
            }}
          >
            Alternative media discourse, quantified.
          </div>
          <div
            style={{
              fontSize: 20,
              color: "#6b7280",
              display: "flex",
              gap: 12,
            }}
          >
            <span>{data.numChannels.toLocaleString()} channels</span>
            <span style={{ color: "#d1d5db" }}>·</span>
            <span>
              {data.numEpisodes.toLocaleString()} episodes
            </span>
            <span style={{ color: "#d1d5db" }}>·</span>
            <span>as of {asOfFormatted}</span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
