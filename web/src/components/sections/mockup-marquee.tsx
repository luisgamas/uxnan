import { cn } from "@/lib/utils";

export type MockupMarqueeItem = {
  key: string;
  product?: string;
  title: string;
  body: string;
  visual: React.ReactNode;
};

/**
 * Horizontal auto-scrolling feature cards at the same visual weight as the
 * Two Apps cards (generous padding, roomy mockup stage). Used on home and the
 * product pages so mockups stay readable without stretching vertical scroll.
 */
export function MockupMarquee({
  items,
  dual = true,
  className,
}: {
  items: MockupMarqueeItem[];
  /** Two counter-scrolling rows when there are enough cards. */
  dual?: boolean;
  className?: string;
}) {
  const rowA = dual ? items.filter((_, i) => i % 2 === 0) : items;
  const rowB = dual ? items.filter((_, i) => i % 2 === 1) : [];

  return (
    <div className={cn("overflow-hidden", className)}>
      <div className="space-y-6" data-reveal>
        <MarqueeRow items={rowA.length ? rowA : items} duration={95} />
        {dual && rowB.length > 0 && (
          <MarqueeRow items={rowB} duration={115} reverse />
        )}
      </div>

      <ul className="sr-only">
        {items.map((item) => (
          <li key={item.key}>
            {item.product ? `${item.product}: ` : ""}
            {item.title}. {item.body}
          </li>
        ))}
      </ul>
    </div>
  );
}

const REPEATS_PER_HALF = 2;

function MarqueeRow({
  items,
  duration,
  reverse = false,
}: {
  items: MockupMarqueeItem[];
  duration: number;
  reverse?: boolean;
}) {
  const half = Array.from({ length: REPEATS_PER_HALF }, () => items).flat();
  const loop = [...half, ...half];

  return (
    <div className="mask-edges overflow-hidden" aria-hidden>
      <div
        className="feature-marquee flex w-max gap-5 px-2 md:gap-6"
        style={{
          animation: `ux-marquee ${duration}s linear infinite${reverse ? " reverse" : ""}`,
        }}
      >
        {loop.map((item, index) => (
          <article
            key={`${item.key}-${index}`}
            className={cn(
              "card-wash flex w-[min(88vw,22rem)] shrink-0 flex-col rounded-2xl border border-border/70 p-6 md:w-[24rem] md:p-8",
            )}
          >
            <div className="mb-6 flex h-[220px] items-center justify-center overflow-hidden rounded-xl border border-border/50 bg-surface/50 md:h-[240px]">
              {item.visual}
            </div>
            {item.product && (
              <span className="mb-2.5 inline-flex w-fit rounded-full border border-border bg-surface-raised px-2.5 py-0.5 text-[11.5px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
                {item.product}
              </span>
            )}
            <h3 className="text-[1.125rem] font-semibold leading-snug md:text-[1.25rem]">
              {item.title}
            </h3>
            <p className="mt-2.5 text-[15px] leading-[1.65] text-muted-foreground md:text-[15.5px]">
              {item.body}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
