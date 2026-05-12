import fs from "node:fs";
import path from "node:path";
import ReactMarkdown from "react-markdown";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

/**
 * Public changelog page. Renders CHANGELOG.md (committed at the project
 * root) so the markdown file remains the single source of truth and gets
 * updated on every release without page-side duplication.
 */
const CHANGELOG_PATH = path.join(process.cwd(), "CHANGELOG.md");

function loadChangelog(): string {
  try {
    return fs.readFileSync(CHANGELOG_PATH, "utf-8");
  } catch {
    return "## No changelog available\n\nThe `CHANGELOG.md` file could not be read.";
  }
}

export default function ChangelogPage() {
  const content = loadChangelog();
  // Strip the leading H1 from the markdown since the page already has one.
  const cleaned = content.replace(/^#\s+.+\n+/, "");

  return (
    <main className="min-h-screen">
      <Header />

      <section className="px-6 pt-10 pb-16 max-w-3xl mx-auto">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">
          <a href="/" className="hover:text-gray-700">
            ← Soapbox Index
          </a>
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          Changelog
        </h1>
        <p className="text-gray-600 mt-3 leading-relaxed max-w-2xl">
          Every release of soapbox.media. What shipped, what we disclosed, what
          is known to be limited. The platform is in active development through
          the November 2026 US midterms; expect frequent updates and
          methodology refinements.
        </p>

        <article
          className="
            prose prose-gray max-w-none mt-10
            prose-headings:font-semibold prose-headings:tracking-tight
            prose-h2:mt-12 prose-h2:mb-4 prose-h2:text-xl
            prose-h3:mt-8 prose-h3:mb-3 prose-h3:text-base prose-h3:uppercase prose-h3:tracking-wider prose-h3:text-gray-500
            prose-p:text-gray-700 prose-p:leading-relaxed
            prose-li:text-gray-700 prose-li:my-1
            prose-strong:text-gray-900
            prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-gray-800 prose-code:font-normal prose-code:text-sm
            prose-code:before:content-none prose-code:after:content-none
            prose-a:text-gray-900 prose-a:underline hover:prose-a:text-gray-700
          "
        >
          <ReactMarkdown>{cleaned}</ReactMarkdown>
        </article>
      </section>

      <Footer />
    </main>
  );
}
