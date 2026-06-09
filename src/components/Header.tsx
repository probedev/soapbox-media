import Image from "next/image";
import logoCrate from "@/assets/logo-crate.png";

type ActivePage = "issues" | "channels" | "emerging" | "activity" | "methodology" | null;

interface HeaderProps {
  /** When set, that nav link gets the bolded/active treatment */
  activePage?: ActivePage;
}

/**
 * Shared site header used on every page. Centralizes the nav so adding a
 * new route only requires a single edit.
 */
export function Header({ activePage = null }: HeaderProps) {
  const linkClass = (page: Exclude<ActivePage, null>) =>
    activePage === page
      ? "hover:text-foreground font-semibold text-foreground"
      : "hover:text-foreground";

  return (
    <header className="border-b border-border bg-card">
      <div className="max-w-5xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <a href="/" className="flex items-center gap-2" aria-label="Soapbox home">
          <Image
            src={logoCrate}
            alt=""
            width={32}
            height={32}
            priority
            placeholder="blur"
            className="w-7 h-7 object-contain select-none"
            draggable={false}
          />
          <span className="font-black text-2xl tracking-tight leading-none relative -top-[2px]">
            <span className="text-[#C8202F]">soap</span>
            <span className="text-[#114A8A]">box</span>
          </span>
        </a>
        <nav className="text-sm text-ink-muted flex flex-wrap gap-4 sm:gap-6">
          <a href="/issues" className={linkClass("issues")}>Issues</a>
          <a href="/channels" className={linkClass("channels")}>Channels</a>
          <a href="/emerging" className={linkClass("emerging")}>Emerging</a>
          <a href="/log" className={linkClass("activity")}>Activity</a>
          <a href="/methodology" className={linkClass("methodology")}>Methodology</a>
        </nav>
      </div>
    </header>
  );
}
