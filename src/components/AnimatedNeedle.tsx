"use client";

import * as React from "react";

// Geometry shared with SoapboxNeedle (the needle is drawn straight up and rotated).
const cx = 200;
const cy = 200;
const needleLen = 130;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(m.matches);
    update();
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, []);
  return reduced;
}

/**
 * The animated needle island for the home hero. A critically-near-damped spring
 * (~7% overshoot, ~0.8s) drives the rotation - it enters from center (0) on first
 * mount and re-settles whenever the Index value changes, like an analog meter
 * finding its reading. The spring writes the SVG `transform` straight to the DOM
 * via a ref (no per-frame React re-render). `prefers-reduced-motion` snaps. SSR
 * renders the correct final angle (`targetRot`), so no-JS shows the right value.
 *
 * Lives in its own "use client" file so the rest of SoapboxNeedle (and every
 * static sub-needle) stays a server-rendered SVG with no hydration cost.
 */
export function AnimatedNeedle({ targetRot }: { targetRot: number }) {
  const needleRef = React.useRef<SVGGElement>(null);
  const posRef = React.useRef<number | null>(null); // current rotation (null = not mounted yet)
  const velRef = React.useRef(0);
  const rafRef = React.useRef(0);
  const reduced = usePrefersReducedMotion();

  React.useEffect(() => {
    const g = needleRef.current;
    if (!g) return;
    const setRot = (deg: number) => g.setAttribute("transform", `rotate(${deg} ${cx} ${cy})`);

    if (reduced) {
      posRef.current = targetRot;
      setRot(targetRot);
      return;
    }

    // Enter from center (0) on the first run; otherwise spring from where we are.
    if (posRef.current === null) {
      posRef.current = 0;
      velRef.current = 0;
      setRot(0);
    }

    // Underdamped spring: ω_n=√120≈11, ζ=14/(2·11)≈0.64 → ~7% overshoot, ~0.8s.
    const stiffness = 120;
    const damping = 14;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      const x = posRef.current as number;
      const v = velRef.current;
      const accel = -stiffness * (x - targetRot) - damping * v;
      velRef.current = v + accel * dt;
      posRef.current = x + velRef.current * dt;
      if (Math.abs(posRef.current - targetRot) < 0.01 && Math.abs(velRef.current) < 0.02) {
        posRef.current = targetRot;
        velRef.current = 0;
        setRot(targetRot);
        return;
      }
      setRot(posRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [targetRot, reduced]);

  return (
    <g ref={needleRef} transform={`rotate(${targetRot} ${cx} ${cy})`}>
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
  );
}
