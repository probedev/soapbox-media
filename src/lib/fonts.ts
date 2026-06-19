import localFont from "next/font/local";

/**
 * Protest Strike: the wordmark/display typeface (the "soapbox" logotype only).
 * Self-hosted so the live site and the downloadable brand assets share one font
 * source and never drift. Body/UI/data type is Geist (set on <html> in layout).
 * Single weight (400); the face is heavy by design.
 */
export const protestStrike = localFont({
  src: "../assets/fonts/ProtestStrike-Regular.ttf",
  weight: "400",
  display: "swap",
  variable: "--font-wordmark",
});
