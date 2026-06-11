import { AnimatedNeedle } from "./AnimatedNeedle";

interface SoapboxNeedleProps {
  /** Soapbox Index value, clamped to [-10, +10]. Negative = L, Positive = R. */
  value: number;
  width?: number;
  height?: number;
  /** Animate the needle settling in (analog-meter spring). Off by default so a
   *  needle stays static, server-rendered SVG; animated instances opt in. */
  animated?: boolean;
  /** Stagger the entrance animation by this many ms (only when `animated`). */
  delayMs?: number;
}

// Geometry
const cx = 200;
const cy = 200;
const r = 150;
const needleLen = 130;

/** Needle rotation (deg, SVG clockwise) for an index value: 0 -> up, -10 -> left,
 *  +10 -> right. The needle is drawn pointing straight up and rotated. */
function rotForValue(v: number): number {
  return (Math.max(-10, Math.min(10, v)) / 10) * 90;
}

/**
 * The Soapbox Index needle - a half-circle gauge from L 10 to R 10. Server-
 * rendered SVG; the chrome (arc, ticks, labels, hub) has no client state. With
 * `animated`, the needle is delegated to the <AnimatedNeedle> client island,
 * which springs it into place like an analog meter (home hero only). Without it,
 * the needle is a static rotated <g>. (Sanctioned hand-built SVG gauge - see
 * CLAUDE.md.)
 */
export function SoapboxNeedle({ value, width = 420, height = 260, animated = false, delayMs = 0 }: SoapboxNeedleProps) {
  const clamped = Math.max(-10, Math.min(10, value));
  const targetRot = rotForValue(clamped);

  // Arc path from (cx - r, cy) sweeping over the top to (cx + r, cy).
  const arcPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;

  return (
    <svg
      viewBox="0 0 400 260"
      width={width}
      height={height}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Soapbox Index: ${clamped.toFixed(1)}`}
    >
      <defs>
        <linearGradient id="gauge-gradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="50%" stopColor="#e5e7eb" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
      </defs>

      {/* The gauge arc */}
      <path
        d={arcPath}
        stroke="url(#gauge-gradient)"
        strokeWidth="28"
        fill="none"
        strokeLinecap="round"
      />

      {/* Tick marks at -10, -5, 0, +5, +10 */}
      {[-10, -5, 0, 5, 10].map((tickVal) => {
        const tt = (tickVal + 10) / 20;
        const tickAngleDeg = (1 - tt) * 180;
        const tickAngleRad = (tickAngleDeg * Math.PI) / 180;
        const inner = r - 18;
        const outer = r + 4;
        return (
          <line
            key={tickVal}
            x1={cx + inner * Math.cos(tickAngleRad)}
            y1={cy - inner * Math.sin(tickAngleRad)}
            x2={cx + outer * Math.cos(tickAngleRad)}
            y2={cy - outer * Math.sin(tickAngleRad)}
            stroke="#9ca3af"
            strokeWidth="2"
          />
        );
      })}

      {/* End labels */}
      <text x={cx - r} y={cy + 28} textAnchor="middle" className="fill-blue-600" fontSize="14" fontWeight="600">
        L 10
      </text>
      <text x={cx} y={cy - r - 14} textAnchor="middle" className="fill-muted-foreground" fontSize="13">
        0
      </text>
      <text x={cx + r} y={cy + 28} textAnchor="middle" className="fill-red-600" fontSize="14" fontWeight="600">
        R 10
      </text>

      {/* Needle - drawn straight up, rotated about the hub. */}
      {animated ? (
        <AnimatedNeedle targetRot={targetRot} delayMs={delayMs} />
      ) : (
        <g transform={`rotate(${targetRot} ${cx} ${cy})`}>
          <line
            x1={cx}
            y1={cy}
            x2={cx}
            y2={cy - needleLen}
            stroke="#111827"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </g>
      )}
      <circle cx={cx} cy={cy} r="9" fill="#111827" />
      <circle cx={cx} cy={cy} r="3.5" fill="#ffffff" />
    </svg>
  );
}
