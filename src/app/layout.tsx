import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { PostHogProvider } from "@/components/PostHogProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Soapbox: The FiveThirtyEight of Alternative Political Media",
  description:
    "A daily-updating dashboard that quantifies what top political podcasts and YouTube voices are saying, how loudly, and which way the broader discourse is tilting.",
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
