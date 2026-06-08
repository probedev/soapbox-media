interface WeeklyHeadlineProps {
  /** Fully-assembled headline string from buildAutoHeadline(). */
  text?: string;
  /** Optional href - when present, wraps the headline in a link with a subtle "see more" affordance. */
  href?: string;
}

/**
 * Auto-generated period summary that sits below the needle. Refreshes daily
 * via the trailing-7-day window. When `href` is provided (typically pointing
 * to the methodology page's contribution chart), the headline becomes an
 * affordance for "see how we got here."
 */
export function WeeklyHeadline({ text, href }: WeeklyHeadlineProps) {
  if (text) {
    const content = (
      <>
        <p className="text-lg md:text-xl text-gray-800 leading-relaxed">{text}</p>
        {href && (
          <div className="text-[11px] uppercase tracking-wider text-gray-500 mt-3 group-hover:text-gray-900 transition">
            See the per-issue breakdown →
          </div>
        )}
      </>
    );
    if (href) {
      return (
        <a
          href={href}
          className="block group max-w-2xl mx-auto text-center cursor-pointer"
        >
          {content}
        </a>
      );
    }
    return <div className="max-w-2xl mx-auto text-center">{content}</div>;
  }

  return (
    <p className="text-base md:text-lg text-gray-500 leading-relaxed text-center max-w-2xl mx-auto italic">
      The auto-generated headline will appear here once the daily pipeline
      assembles it, surfacing which issue dominated alt-media in the trailing
      window, which channels drove the Soapbox Index movement, and the
      single-line read for casual visitors.
    </p>
  );
}
