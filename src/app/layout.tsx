import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { PostHogProvider } from "@/components/PostHogProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Soapbox · Online political media, quantified",
  description:
    "Soapbox quantifies what political media on YouTube and podcasts is saying about US policy issues - across independent creators and legacy institutions. Updated daily.",
  openGraph: {
    title: "Soapbox · Online political media, quantified",
    description:
      "Soapbox quantifies what political media on YouTube and podcasts is saying about US policy issues - across independent creators and legacy institutions. Updated daily.",
    url: "https://soapbox.media",
    siteName: "Soapbox",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Soapbox · Online political media, quantified",
    description:
      "What political media on YouTube and podcasts is saying about US policy issues. Updated daily.",
  },
  // Favicon is auto-detected from src/app/icon.png (Next.js convention).
  // OG/Twitter image is auto-detected from src/app/opengraph-image.tsx.
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={GeistSans.className}>
      <body className="bg-card text-foreground antialiased">
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
