"use client";

/**
 * Scroll-reveal primitives for the homelab2 dashboard. Recharts animates on
 * MOUNT, so to get "animate as it scrolls into view" we defer mounting a panel's
 * children until its container first intersects the viewport - then the chart
 * mounts and plays its entrance animation exactly when the user reaches it. A
 * fade/translate-in is layered on top for everything (charts and plain content).
 *
 * minHeight reserves space so deferring the mount doesn't cause scroll jank.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

/** Returns [ref, inView]. Fires once (stops observing after first intersection). */
export function useInView<T extends Element = HTMLDivElement>(
  rootMargin = "0px 0px -10% 0px",
): [React.RefObject<T>, boolean] {
  const ref = React.useRef<T>(null);
  const [inView, setInView] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true); // SSR / unsupported: just show it
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          obs.disconnect();
        }
      },
      { rootMargin, threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView, rootMargin]);

  return [ref, inView];
}

/**
 * Reveal wrapper: fades + slides its children in when scrolled into view. By
 * default it also DEFERS mounting the children until first in-view (mountOnView)
 * so charts animate on scroll-in; pass mountOnView={false} for cheap static
 * content that should render server-side.
 */
export function Reveal({
  children,
  className,
  minHeight,
  mountOnView = true,
}: {
  children: React.ReactNode;
  className?: string;
  /** Reserve vertical space so deferred mounts don't shift the scroll. */
  minHeight?: number;
  mountOnView?: boolean;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      style={minHeight && !inView ? { minHeight } : undefined}
      className={cn(
        "transition-all duration-700 ease-out motion-reduce:transition-none",
        inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3",
        className,
      )}
    >
      {mountOnView ? (inView ? children : null) : children}
    </div>
  );
}
