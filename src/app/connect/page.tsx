import type { Metadata } from "next";

import { ConnectGuide } from "@/components/ConnectGuide";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Connect Soapbox to your AI app - Setup guide",
  description:
    "Step by step: connect Claude, ChatGPT, Cursor, or any MCP-capable AI app to the Soapbox political-media dataset. About two minutes, no coding required.",
};

export default function ConnectPage() {
  return (
    <main className="min-h-screen">
      <Header />

      <section className="px-6 pt-10 pb-16 max-w-2xl mx-auto">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          Connect Soapbox to your AI app
        </h1>
        <p className="text-ink-muted mt-3 leading-relaxed">
          Soapbox plugs into any AI assistant that supports MCP connectors - Claude, ChatGPT,
          Cursor, and more. Follow these steps and you&apos;ll be asking questions in about two
          minutes. No coding required.
        </p>

        <div className="mt-9">
          <ConnectGuide />
        </div>
      </section>

      <Footer />
    </main>
  );
}
