import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { PostHogProvider } from "@/components/PostHogProvider";
import { SITE_TITLE, META_DESCRIPTION } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: META_DESCRIPTION,
  openGraph: {
    title: SITE_TITLE,
    description: META_DESCRIPTION,
    url: "https://soapbox.media",
    siteName: "Soapbox",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: META_DESCRIPTION,
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
