import { useState } from 'react';

export interface BarDatum {
  label: string;
  value: number;
  /** A chart token, e.g. "var(--chart-1)". Defaults to the single-series hue. */
  color?: string;
}

/**
 * Horizontal bars for counts by category (dataviz: bars ≤24px, 4px rounded data end, square
 * at the baseline, 2px gap between bars, value at the tip in text ink, hover tooltip). One
 * series needs no legend; a diverging scale gets its legend from the labels themselves.
 */
export function BarList({
  data,
  format = (v) => v.toLocaleString(),
  ariaLabel,
}: {
  data: BarDatum[];
  format?: (v: number) => string;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <figure aria-label={ariaLabel} className="space-y-0.5">
      {data.map((d, i) => {
        const share = total > 0 ? (d.value / total) * 100 : 0;
        return (
          <div
            key={d.label}
            className="group relative grid grid-cols-[9rem_1fr] items-center gap-3 rounded py-[3px] text-xs"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="truncate text-right text-muted-foreground">{d.label}</span>
            <div className="flex items-center gap-2">
              <div
                className="h-5 rounded-r-[4px] transition-opacity"
                style={{
                  width: `${Math.max(0.5, (d.value / max) * 85)}%`,
                  background: d.color ?? 'var(--chart-1)',
                  opacity: hover === null || hover === i ? 1 : 0.55,
                }}
              />
              <span className="tabular-nums text-foreground">{format(d.value)}</span>
            </div>
            {hover === i && (
              <div
                role="tooltip"
                className="pointer-events-none absolute left-[10rem] top-full z-10 mt-1 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
              >
                <div className="font-medium">{d.label}</div>
                <div className="tabular-nums text-muted-foreground">
                  {format(d.value)} · {share.toFixed(1)}% of total
                </div>
              </div>
            )}
          </div>
        );
      })}
      <figcaption className="sr-only">
        {data.map((d) => `${d.label}: ${format(d.value)}`).join('; ')}
      </figcaption>
    </figure>
  );
}
