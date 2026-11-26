import { useState } from 'react';

export interface ColumnSeries {
  key: string;
  label: string;
  /** Categorical slot in order: var(--chart-1), var(--chart-2), … */
  color: string;
}

/**
 * Columns per category with one bar per series (dataviz: one axis, fixed categorical order,
 * thin bars with 4px rounded tops anchored to the baseline, 2px gaps, recessive grid, legend
 * for 2+ series, hover tooltip per category, values in text ink, table view for exact numbers).
 */
export function GroupedColumns({
  categories,
  series,
  values,
  format,
  ariaLabel,
}: {
  categories: { key: string; label: string }[];
  series: ColumnSeries[];
  /** values[category][series] */
  values: Record<string, Record<string, number>>;
  format: (v: number) => string;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(
    1,
    ...categories.flatMap((c) => series.map((s) => values[c.key]?.[s.key] ?? 0)),
  );
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const H = 180;

  return (
    <figure aria-label={ariaLabel}>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px]" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="relative grid grid-cols-[3.5rem_1fr] gap-2">
        <div className="relative" style={{ height: H }}>
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-0 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground"
              style={{ top: H - (t / top) * H }}
            >
              {format(t)}
            </span>
          ))}
        </div>
        <div className="relative" style={{ height: H }}>
          {ticks.map((t) => (
            <div
              key={t}
              className="absolute inset-x-0 border-t border-border/60"
              style={{ top: H - (t / top) * H }}
            />
          ))}
          <div className="absolute inset-0 flex items-end gap-1">
            {categories.map((c) => (
              <div
                key={c.key}
                className="relative flex h-full flex-1 items-end justify-center gap-[2px] rounded-sm hover:bg-muted/40"
                onMouseEnter={() => setHover(c.key)}
                onMouseLeave={() => setHover(null)}
              >
                {series.map((s) => {
                  const v = values[c.key]?.[s.key] ?? 0;
                  return (
                    <div
                      key={s.key}
                      className="w-full max-w-4 rounded-t-[4px]"
                      style={{
                        height: v > 0 ? Math.max(2, (v / top) * H) : 0,
                        background: s.color,
                      }}
                    />
                  );
                })}
                {hover === c.key && (
                  <div
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
                  >
                    <div className="font-medium">{c.label}</div>
                    {series.map((s) => (
                      <div key={s.key} className="flex items-center gap-1.5 tabular-nums">
                        <span className="size-2 rounded-[2px]" style={{ background: s.color }} />
                        {s.label}: {format(values[c.key]?.[s.key] ?? 0)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div />
        <div className="flex gap-1">
          {categories.map((c) => (
            <span
              key={c.key}
              className="flex-1 truncate text-center text-[11px] text-muted-foreground"
            >
              {c.label}
            </span>
          ))}
        </div>
      </div>
      <figcaption className="sr-only">
        {categories
          .map(
            (c) =>
              `${c.label}: ${series.map((s) => `${s.label} ${format(values[c.key]?.[s.key] ?? 0)}`).join(', ')}`,
          )
          .join('; ')}
      </figcaption>
    </figure>
  );
}

/** 1, 2 or 5 × a power of ten, at least `raw`. */
function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
}
