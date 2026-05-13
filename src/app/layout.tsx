import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { PostHogProvider } from "@/components/PostHogProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Soapbox · Alternative media discourse, quantified",
  description:
    "Soapbox is a data platform that uses language models to quantify what major alternative media is saying about US policy issues. We ingest and process new episodes daily.",
  openGraph: {
    title: "Soapbox · Alternative media discourse, quantified",
    description:
      "Soapbox is a data platform that uses language models to quantify what major alternative media is saying about US policy issues. We ingest and process new episodes daily.",
    url: "https://soapbox.media",
    siteName: "Soapbox",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Soapbox · Alternative media discourse, quantified",
    description:
      "What major alternative media is saying about US policy issues. Updated daily.",
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
      <body className="bg-white text-gray-900 antialiased">
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
