import Image from "next/image";
import logoCrate from "@/assets/logo-crate.png";

type ActivePage = "issues" | "channels" | "methodology" | null;

interface HeaderProps {
  /** When set, that nav link gets the bolded/active treatment */
  activePage?: ActivePage;
}

/**
 * Shared site header used on every page. Centralizes the nav so adding a
 * new route only requires a single edit. /log lives in the footer rather
 * than the top nav — it's a transparency surface, not a primary user
 * destination.
 */
export function Header({ activePage = null }: HeaderProps) {
  const linkClass = (page: Exclude<ActivePage, null>) =>
    activePage === page
      ? "hover:text-gray-900 font-semibold text-gray-900"
      : "hover:text-gray-900";

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2.5" aria-label="Soapbox home">
          <Image
            src={logoCrate}
            alt=""
            width={36}
            height={36}
            priority
            placeholder="blur"
            className="w-9 h-9 object-contain select-none"
            draggable={false}
          />
          <span className="font-black text-2xl tracking-tight leading-none">
            <span className="text-[#C8202F]">soap</span>
            <span className="text-[#114A8A]">box</span>
          </span>
        </a>
        <nav className="text-sm text-gray-600 flex gap-6">
          <a href="/issues" className={linkClass("issues")}>Issues</a>
          <a href="/channels" className={linkClass("channels")}>Channels</a>
          <a href="/methodology" className={linkClass("methodology")}>Methodology</a>
        </nav>
      </div>
    </header>
  );
}
