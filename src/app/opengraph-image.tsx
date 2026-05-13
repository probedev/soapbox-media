/**
 * Dynamic Open Graph image for the home page.
 *
 * Mirrors the actual home page visual identity: the wooden-crate logo,
 * the red/blue soapbox wordmark, the half-circle gauge needle (same SVG
 * geometry as `<SoapboxNeedle>`), and the live Index value. When the URL
 * is shared (iMessage, Twitter/X, Slack, LinkedIn) the preview reflects
 * the current state of the dataset rather than a static asset.
 *
 * Auto-detected by Next.js App Router. The metadata in `layout.tsx`
 * references the same image for Twitter cards via `summary_large_image`.
 *
 * Runtime: nodejs (not edge) — we need fs.readFileSync to inline the
 * crate PNG, and `getDashboardData` can pull thousands of rows with deep
 * joins. Vercel caches OG images by URL so cold-start cost is amortized.
 */
import { ImageResponse } from "next/og";
import fs from "fs";
import path from "path";
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

// Inline the crate logo as a base64 data URI. We use the 256x256 favicon
// version rather than the 1024x1024 source asset — same visual, ~20x
// smaller payload (~56KB vs ~1.2MB).
function loadCrateDataUri(): string | null {
  try {
    const p = path.join(process.cwd(), "src/app/icon.png");
    const buf = fs.readFileSync(p);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function OpengraphImage() {
  let data: Awaited<ReturnType<typeof getDashboardData>>;
  try {
    data = await getDashboardData(7);
  } catch {
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

  const crateDataUri = loadCrateDataUri();

  const indexAbs = Math.abs(data.index);
  const indexColor =
    data.index > 0.05 ? "#C8202F" : data.index < -0.05 ? "#114A8A" : "#374151";
  const directionLabel =
    data.index > 0.05 ? "R+" : data.index < -0.05 ? "L+" : "";
  const indexText = directionLabel + indexAbs.toFixed(1);
  const asOfFormatted = formatAsOf(data.asOfDate);

  // --- Needle gauge geometry — identical math to <SoapboxNeedle> ---
  const clamped = Math.max(-10, Math.min(10, data.index));
  const t = (clamped + 10) / 20;
  const angleDeg = (1 - t) * 180;
  const angleRad = (angleDeg * Math.PI) / 180;
  const cx = 200;
  const cy = 200;
  const r = 150;
  const needleLen = 130;
  const needleX = cx + needleLen * Math.cos(angleRad);
  const needleY = cy - needleLen * Math.sin(angleRad);
  const arcPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;

  const ticks = [-10, -5, 0, 5, 10].map((tickVal) => {
    const tt = (tickVal + 10) / 20;
    const tickAngleDeg = (1 - tt) * 180;
    const tickAngleRad = (tickAngleDeg * Math.PI) / 180;
    const inner = r - 18;
    const outer = r + 4;
    return {
      key: tickVal,
      x1: cx + inner * Math.cos(tickAngleRad),
      y1: cy - inner * Math.sin(tickAngleRad),
      x2: cx + outer * Math.cos(tickAngleRad),
      y2: cy - outer * Math.sin(tickAngleRad),
    };
  });

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#ffffff",
          padding: "60px 80px",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        {/* Top: crate + wordmark, matching the site header */}
        <div style={{ display: "flex", alignItems: "center" }}>
          {crateDataUri && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={crateDataUri}
              width={64}
              height={64}
              style={{ marginRight: 14, objectFit: "contain" }}
              alt=""
            />
          )}
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

        {/* Hero: gauge + index number */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            flex: 1,
            justifyContent: "center",
          }}
        >
          <div
            style={{
              fontSize: 18,
              color: "#6b7280",
              textTransform: "uppercase",
              letterSpacing: "0.18em",
              marginBottom: 6,
              fontWeight: 600,
              display: "flex",
            }}
          >
            The Soapbox Index · last 7 days
          </div>

          {/* Curved gauge SVG — same geometry as <SoapboxNeedle>. Text
              labels are rendered as HTML below the SVG because Satori
              (the renderer behind next/og's ImageResponse) does not
              support <text> nodes. */}
          <svg
            width={420}
            height={235}
            viewBox="0 0 400 220"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient id="gauge-gradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="50%" stopColor="#e5e7eb" />
                <stop offset="100%" stopColor="#ef4444" />
              </linearGradient>
            </defs>

            <path
              d={arcPath}
              stroke="url(#gauge-gradient)"
              strokeWidth={28}
              fill="none"
              strokeLinecap="round"
            />

            {ticks.map((tk) => (
              <line
                key={tk.key}
                x1={tk.x1}
                y1={tk.y1}
                x2={tk.x2}
                y2={tk.y2}
                stroke="#9ca3af"
                strokeWidth={2}
              />
            ))}

            <line
              x1={cx}
              y1={cy}
              x2={needleX}
              y2={needleY}
              stroke="#111827"
              strokeWidth={4}
              strokeLinecap="round"
            />
            <circle cx={cx} cy={cy} r={9} fill="#111827" />
            <circle cx={cx} cy={cy} r={3.5} fill="#ffffff" />
          </svg>

          {/* HTML labels positioned beneath the gauge endpoints */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              width: 420,
              marginTop: -8,
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            <span style={{ color: "#2563eb" }}>L 10</span>
            <span style={{ color: "#6b7280", fontWeight: 400 }}>0</span>
            <span style={{ color: "#dc2626" }}>R 10</span>
          </div>

          {/* Index number below the gauge */}
          <div
            style={{
              fontSize: 110,
              fontWeight: 700,
              letterSpacing: "-0.04em",
              color: indexColor,
              lineHeight: 1,
              marginTop: -10,
              display: "flex",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {data.hasData ? indexText : "—"}
          </div>
        </div>

        {/* Bottom: tagline + stats */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 28,
              color: "#1f2937",
              fontWeight: 500,
              marginBottom: 10,
              display: "flex",
            }}
          >
            Alternative media discourse, quantified.
          </div>
          <div
            style={{
              fontSize: 18,
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
