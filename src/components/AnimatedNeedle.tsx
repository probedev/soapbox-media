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
export function AnimatedNeedle({ targetRot, delayMs = 0 }: { targetRot: number; delayMs?: number }) {
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
    const firstRun = posRef.current === null;
    if (firstRun) {
      posRef.current = 0;
      velRef.current = 0;
      setRot(0);
    }

    // Underdamped spring: ω_n=√100=10, ζ=10/(2·10)=0.50 → ~16% overshoot, ~0.8s.
    const stiffness = 100;
    const damping = 10;
    let last = 0;

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

    const startSpring = () => {
      last = performance.now();
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };

    // Stagger the entrance (only the first run); value-change re-settles are immediate.
    let timer = 0;
    if (firstRun && delayMs > 0) timer = window.setTimeout(startSpring, delayMs);
    else startSpring();

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(rafRef.current);
    };
  }, [targetRot, reduced, delayMs]);

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
