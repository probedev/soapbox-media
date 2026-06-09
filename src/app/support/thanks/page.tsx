import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";

export const dynamic = "force-dynamic";

export default function SupportThanksPage() {
  return (
    <main className="min-h-screen">
      <Header />
      <section className="px-6 pt-20 pb-24 max-w-xl mx-auto text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Thank you 🙏</h1>
        <p className="text-ink-muted mt-4 leading-relaxed">
          Your support keeps Soapbox independent and free to read. We measure what political media is
          saying so everyone argues from the same scoreboard - and you just helped keep it running.
        </p>
        <p className="text-muted-foreground text-sm mt-4">A receipt is on its way to your email.</p>
        <div className="mt-8 flex gap-3 justify-center">
          <a href="/" className="rounded-md bg-primary text-white px-5 py-2.5 text-sm font-medium hover:bg-primary/90">See the Index</a>
          <a href="/methodology" className="rounded-md border border-input px-5 py-2.5 text-sm font-medium text-ink-body hover:bg-subtle">How it works</a>
        </div>
      </section>
      <Footer />
    </main>
  );
}
