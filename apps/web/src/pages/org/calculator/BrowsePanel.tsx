import type { CalculatorBrowseResult, CalculatorFacets } from '@app/shared';
import { ArrowDown, ArrowUp, SlidersHorizontal, X } from 'lucide-react';
import { useState } from 'react';
import { Pagination } from '@/components/data/Pagination';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrgQuery } from '@/hooks/useOrgQuery';
import { qs } from '@/hooks/useUrlState';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { whole } from './EstimateView';

/** URL keys for the browse filters (shared links keep the view). */
export const BROWSE_KEYS = [
  'kind',
  'use',
  'hood',
  'zip',
  'grade',
  'minMarket',
  'maxMarket',
  'minArea',
  'maxArea',
  'minYear',
  'maxYear',
  'homestead',
  'over65',
  'minEquity',
  'sort',
  'dir',
] as const;
type BrowseKey = (typeof BROWSE_KEYS)[number];
type Values = Record<BrowseKey, string>;

const SORTS = [
  ['equity', 'Above neighbors'],
  ['market', 'Market value'],
  ['area', 'Area'],
  ['year', 'Year built'],
  ['address', 'Address'],
] as const;

/** A text/number box that updates the URL when you leave it or press Enter, not per keystroke. */
function FilterInput({
  label,
  value,
  onCommit,
  className,
  ...props
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setText(value);
  }
  const commit = () => text.trim() !== value && onCommit(text.trim());
  return (
    <label className={cn('grid gap-1 text-xs text-muted-foreground', className)}>
      {label}
      <Input
        {...props}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className="h-8"
      />
    </label>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly (readonly [string, string])[];
  className?: string;
}) {
  return (
    <label className={cn('grid gap-1 text-xs text-muted-foreground', className)}>
      {label}
      <NativeSelect className="h-8" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}

function EquityBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-muted-foreground">—</span>;
  const sign = pct > 0 ? '+' : '';
  return (
    <Badge variant={pct >= 15 ? 'warning' : pct <= -15 ? 'success' : 'secondary'}>
      {sign}
      {pct.toFixed(1)}%
    </Badge>
  );
}

export function BrowsePanel({
  countyId,
  taxYear,
  values,
  page,
  set,
  onPick,
}: {
  countyId: number;
  taxYear: number;
  values: Values;
  page: number;
  set: (patch: Partial<Record<BrowseKey | 'page', string | number | null>>) => void;
  onPick: (account: string) => void;
}) {
  const sort = values.sort || 'equity';
  const dir = values.dir || 'desc';
  const facets = useOrgQuery<CalculatorFacets>(`/calculator/facets${qs({ countyId, taxYear })}`);
  const query = qs({
    countyId,
    taxYear,
    page,
    kind: values.kind,
    propertyUse: values.use,
    neighborhood: values.hood,
    zip: values.zip,
    grade: values.grade,
    minMarket: values.minMarket,
    maxMarket: values.maxMarket,
    minArea: values.minArea,
    maxArea: values.maxArea,
    minYear: values.minYear,
    maxYear: values.maxYear,
    homestead: values.homestead,
    over65: values.over65,
    minEquityPct: values.minEquity,
    sort,
    dir,
  });
  const { data, error, isPending } = useOrgQuery<CalculatorBrowseResult>(
    `/calculator/parcels${query}`,
  );
  const active = BROWSE_KEYS.filter((k) => k !== 'sort' && k !== 'dir' && values[k]).length;
  const clearAll = () =>
    set(Object.fromEntries(BROWSE_KEYS.map((k) => [k, null])) as Partial<Values>);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <SlidersHorizontal className="size-4" /> Filters
            {active > 0 && <Badge variant="secondary">{active} on</Badge>}
          </div>
          {active > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              <X /> Clear filters
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <FilterSelect
            label="Property type"
            value={values.kind}
            onChange={(kind) => set({ kind, use: kind === 'COMMERCIAL' ? values.use : null })}
            options={[
              ['', 'Homes and commercial'],
              ['RESIDENTIAL', 'Homes'],
              ['COMMERCIAL', 'Commercial'],
            ]}
          />
          {values.kind === 'COMMERCIAL' && (
            <FilterSelect
              label="Building type"
              value={values.use}
              onChange={(use) => set({ use })}
              className="col-span-2"
              options={[
                ['', 'Any type'],
                ...(facets.data?.propertyUses ?? []).map((u) => [u, u] as const),
              ]}
            />
          )}
          <FilterInput
            label="Above neighbors by at least (%)"
            value={values.minEquity}
            onCommit={(minEquity) => set({ minEquity })}
            type="number"
            placeholder="e.g. 15"
            className="col-span-2 sm:col-span-1"
          />
          <FilterSelect
            label="Homestead"
            value={values.homestead}
            onChange={(homestead) => set({ homestead })}
            options={[
              ['', 'Any'],
              ['yes', 'Homestead'],
              ['no', 'Not homestead'],
            ]}
          />
          <FilterSelect
            label="Over-65 / disabled"
            value={values.over65}
            onChange={(over65) => set({ over65 })}
            options={[
              ['', 'Any'],
              ['no', 'No'],
              ['yes', 'Yes'],
            ]}
          />
          <FilterSelect
            label="Grade"
            value={values.grade}
            onChange={(grade) => set({ grade })}
            options={[
              ['', 'Any grade'],
              ...(facets.data?.grades ?? []).map((g) => [g, g] as const),
            ]}
          />
          <FilterInput
            label="Market value from ($)"
            value={values.minMarket}
            onCommit={(minMarket) => set({ minMarket })}
            type="number"
            min={0}
          />
          <FilterInput
            label="Market value to ($)"
            value={values.maxMarket}
            onCommit={(maxMarket) => set({ maxMarket })}
            type="number"
            min={0}
          />
          <FilterInput
            label="Area from (sq ft)"
            value={values.minArea}
            onCommit={(minArea) => set({ minArea })}
            type="number"
            min={0}
          />
          <FilterInput
            label="Area to (sq ft)"
            value={values.maxArea}
            onCommit={(maxArea) => set({ maxArea })}
            type="number"
            min={0}
          />
          <FilterInput
            label="Built from (year)"
            value={values.minYear}
            onCommit={(minYear) => set({ minYear })}
            type="number"
          />
          <FilterInput
            label="Built to (year)"
            value={values.maxYear}
            onCommit={(maxYear) => set({ maxYear })}
            type="number"
          />
          <FilterInput
            label="ZIP code"
            value={values.zip}
            onCommit={(zip) => set({ zip })}
            inputMode="numeric"
            maxLength={5}
          />
          <FilterInput
            label="Neighborhood code"
            value={values.hood}
            onCommit={(hood) => set({ hood })}
          />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
          <p className="text-xs text-muted-foreground">
            “Above neighbors” compares improvement value per sq ft with the median of comparable
            neighbors (same building type for commercial). Sorting by it lists only properties with
            enough comparables.
          </p>
          <div className="flex items-center gap-1.5">
            <NativeSelect
              aria-label="Sort by"
              className="h-8 w-40"
              value={sort}
              onChange={(e) => set({ sort: e.target.value })}
            >
              {SORTS.map(([v, l]) => (
                <option key={v} value={v}>
                  Sort: {l}
                </option>
              ))}
            </NativeSelect>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              aria-label={dir === 'desc' ? 'Sorted high to low' : 'Sorted low to high'}
              onClick={() => set({ dir: dir === 'desc' ? 'asc' : 'desc' })}
            >
              {dir === 'desc' ? <ArrowDown /> : <ArrowUp />}
            </Button>
          </div>
        </div>
        {error ? (
          <Alert variant="destructive" className="m-4">
            {error.message}
          </Alert>
        ) : isPending ? (
          <Skeleton className="m-4 h-64" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[60rem] text-sm">
                <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Property</th>
                    <th className="px-4 py-2.5 text-left font-medium">Type</th>
                    <th className="px-4 py-2.5 text-right font-medium">Area</th>
                    <th className="px-4 py-2.5 text-right font-medium">Built</th>
                    <th className="px-4 py-2.5 text-left font-medium">Grade</th>
                    <th className="px-4 py-2.5 text-right font-medium">Market</th>
                    <th className="px-4 py-2.5 text-right font-medium">Appraised</th>
                    <th className="px-4 py-2.5 text-right font-medium">Impr. $/sq ft</th>
                    <th className="px-4 py-2.5 text-right font-medium">Vs neighbors</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                        Nothing matches these filters.
                      </td>
                    </tr>
                  )}
                  {data.items.map((p) => (
                    <tr
                      key={p.accountNumber}
                      onClick={() => onPick(p.accountNumber)}
                      className="cursor-pointer border-b last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-4 py-2.5">
                        <div className="font-medium">
                          {p.situsLine ?? 'No situs address'}
                          {p.situsZip && (
                            <span className="ml-1.5 font-normal text-muted-foreground">
                              {p.situsZip}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <span className="font-mono">{p.accountNumber}</span>
                          {p.ownerName && <> · {p.ownerName}</>}
                          {p.homestead && <> · Homestead</>}
                          {p.taxCeiling && <> · Over-65</>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        {p.kind === 'COMMERCIAL' ? (p.propertyUse ?? 'Commercial') : 'Home'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {p.livingAreaSqft?.toLocaleString() ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{p.yearBuilt ?? '—'}</td>
                      <td className="px-4 py-2.5">{p.qualityCode ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {whole(p.marketValue)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {whole(p.appraisedValue)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {p.improvementPerSqft ? formatMoney(p.improvementPerSqft) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <EquityBadge pct={p.equityPct} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPage={(p) => set({ page: p })}
            />
          </>
        )}
      </Card>
    </div>
  );
}
