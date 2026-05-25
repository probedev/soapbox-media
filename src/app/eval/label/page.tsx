import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { LabelClient } from "./LabelClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Soapbox · Scoring calibration",
  robots: { index: false, follow: false },
};

export default function GoldLabelPage() {
  return (
    <main className="min-h-screen">
      <Header />
      <section className="px-6 pt-10 pb-16 max-w-2xl mx-auto">
        <LabelClient />
      </section>
      <Footer />
    </main>
  );
}
