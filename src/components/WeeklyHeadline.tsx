interface WeeklyHeadlineProps {
  /** When the live pipeline is online, pass a fully-assembled headline string. */
  text?: string;
}

/**
 * The auto-generated weekly summary that sits below the needle.
 * Friday's pipeline will assemble this from the week's data
 * ("X dominated alt-media; Y and Z drove a Δ shift"). Until then we render
 * an honest "what's coming here" placeholder rather than fake attribution.
 */
export function WeeklyHeadline({ text }: WeeklyHeadlineProps) {
  if (text) {
    return (
      <p className="text-lg md:text-xl text-gray-800 leading-relaxed text-center max-w-2xl mx-auto">
        {text}
      </p>
    );
  }

  return (
    <p className="text-base md:text-lg text-gray-500 leading-relaxed text-center max-w-2xl mx-auto italic">
      The weekly auto-headline will appear here once the live pipeline ships
      — surfacing which issue dominated alt-media this week, which channels
      drove the Soapbox Index movement, and the single-line read for casual
      visitors.
    </p>
  );
}
