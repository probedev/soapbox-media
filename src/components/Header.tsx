type ActivePage = "issues" | "channels" | "log" | "methodology" | null;

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
      ? "hover:text-gray-900 font-semibold text-gray-900"
      : "hover:text-gray-900";

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <a href="/" className="flex items-baseline gap-1">
          <span className="font-bold text-xl tracking-tight">soapbox</span>
          <span className="text-xs text-gray-500 hidden sm:inline">.media</span>
        </a>
        <nav className="text-sm text-gray-600 flex gap-6">
          <a href="/issues" className={linkClass("issues")}>Issues</a>
          <a href="/channels" className={linkClass("channels")}>Channels</a>
          <a href="/log" className={linkClass("log")}>Activity</a>
          <a href="/methodology" className={linkClass("methodology")}>Methodology</a>
        </nav>
      </div>
    </header>
  );
}
