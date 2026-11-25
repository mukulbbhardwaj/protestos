import type { CadLoadSummary, PlatformCountyDetail, PlatformDataOverview } from '@app/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { BarList } from '@/components/charts/BarList';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/hooks/useMe';
import { useUrlState } from '@/hooks/useUrlState';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const compactMoney = (v: string | number) => {
  const n = Number(v);
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${Math.round(n)}`;
};
const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}%`);

/** Diverging scale for "vs neighbors": blue below, gray within 5%, red above. */
const EQUITY_COLORS: Record<string, string> = {
  '30%+ below': 'var(--chart-neg-3)',
  '15–30% below': 'var(--chart-neg-2)',
  '5–15% below': 'var(--chart-neg-1)',
  'Within 5%': 'var(--chart-mid)',
  '5–15% above': 'var(--chart-pos-1)',
  '15–30% above': 'var(--chart-pos-2)',
  '30%+ above': 'var(--chart-pos-3)',
};

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** Missing-data cell: quiet when complete, flagged when a meaningful share is missing. */
function Missing({ v }: { v: number | null }) {
  if (v === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        'tabular-nums',
        v >= 5 ? 'font-medium text-warning' : v > 0 ? '' : 'text-muted-foreground',
      )}
    >
      {v === 0 ? '0%' : `${v.toFixed(1)}%`}
    </span>
  );
}

function RateCell({ l }: { l: CadLoadSummary }) {
  const share = l.taxUnits ? (l.taxUnitsWithRate / l.taxUnits) * 100 : 0;
  return (
    <span className="whitespace-nowrap tabular-nums">
      {l.taxUnitsWithRate} / {l.taxUnits}
      {l.taxUnitsWithRate === 0 && (
        <Badge variant="warning" className="ml-1.5">
          no rates
        </Badge>
      )}
      {l.taxUnitsWithRate > 0 && share < 50 && (
        <span className="ml-1 text-xs text-muted-foreground">units</span>
      )}
    </span>
  );
}

export function PlatformDataPage() {
  const { data: me } = useMe();
  const { values, set } = useUrlState(['county', 'year'] as const);
  const allowed = me?.user.isSuperAdmin === true;
  const overview = useQuery({
    queryKey: ['admin', 'data', 'overview'],
    queryFn: () => api<PlatformDataOverview>('/admin/data/overview'),
    enabled: allowed,
  });
  const loads = overview.data?.loads ?? [];
  const selected =
    loads.find((l) => String(l.countyId) === values.county && String(l.taxYear) === values.year) ??
    loads[0];
  const detail = useQuery({
    queryKey: ['admin', 'data', 'county', selected?.countyId, selected?.taxYear],
    queryFn: () =>
      api<PlatformCountyDetail>(`/admin/data/counties/${selected!.countyId}/${selected!.taxYear}`),
    enabled: allowed && !!selected,
  });

  if (me && !allowed) {
    return <Alert>This page is for platform administrators.</Alert>;
  }

  return (
    <>
      <PageHeader
        title="Platform data"
        description="What the platform holds: firms’ own records, and the public appraisal rolls behind the calculator. Visible to platform admins only."
      />
      {overview.error ? (
        <Alert variant="destructive">{overview.error.message}</Alert>
      ) : !overview.data ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <div className="space-y-6">
          <section
            aria-label="Totals"
            className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7"
          >
            <Tile label="Firms" value={overview.data.totals.firms.toLocaleString()} />
            <Tile label="Users" value={overview.data.totals.users.toLocaleString()} />
            <Tile label="Clients" value={overview.data.totals.clients.toLocaleString()} />
            <Tile label="Prospects" value={overview.data.totals.prospects.toLocaleString()} />
            <Tile label="Properties" value={overview.data.totals.properties.toLocaleString()} />
            <Tile
              label="Tax-year records"
              value={overview.data.totals.taxYearRecords.toLocaleString()}
            />
            <Tile label="Roll parcels" value={overview.data.totals.cadParcels.toLocaleString()} />
          </section>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Appraisal rolls loaded</CardTitle>
              <CardDescription>
                One row per county and tax year. “Missing” is the share of parcels without that
                field; anything at 5% or more is highlighted. Select a row for its detail.
              </CardDescription>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[68rem] text-sm">
                <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">County</th>
                    <th className="px-4 py-2.5 text-right font-medium">Homes</th>
                    <th className="px-4 py-2.5 text-right font-medium">Commercial</th>
                    <th className="px-4 py-2.5 text-right font-medium">Total value</th>
                    <th className="px-4 py-2.5 text-right font-medium">Median</th>
                    <th className="px-3 py-2.5 text-right font-medium">Area</th>
                    <th className="px-3 py-2.5 text-right font-medium">Year</th>
                    <th className="px-3 py-2.5 text-right font-medium">Grade</th>
                    <th className="px-3 py-2.5 text-right font-medium">Owner</th>
                    <th className="px-4 py-2.5 text-right font-medium">Homestead</th>
                    <th className="px-4 py-2.5 text-right font-medium">Over-65</th>
                    <th className="px-4 py-2.5 text-right font-medium">Indexed</th>
                    <th className="px-4 py-2.5 text-right font-medium">Rated units</th>
                    <th className="px-4 py-2.5 text-left font-medium">Loaded</th>
                  </tr>
                  <tr className="text-[10px] normal-case tracking-normal">
                    <th colSpan={5} />
                    <th colSpan={4} className="pb-1.5 text-center font-normal">
                      missing
                    </th>
                    <th colSpan={5} />
                  </tr>
                </thead>
                <tbody>
                  {loads.map((l) => {
                    const isSel =
                      selected?.countyId === l.countyId && selected?.taxYear === l.taxYear;
                    return (
                      <tr
                        key={`${l.countyId}-${l.taxYear}`}
                        onClick={() => set({ county: l.countyId, year: l.taxYear })}
                        aria-selected={isSel}
                        className={cn(
                          'cursor-pointer border-b last:border-0 hover:bg-muted/40',
                          isSel && 'bg-primary/5 shadow-[inset_3px_0_0_var(--primary)]',
                        )}
                      >
                        <td className="px-4 py-2.5">
                          <div className="font-medium">
                            {l.countyName}{' '}
                            <span className="text-muted-foreground">{l.taxYear}</span>
                          </div>
                          {l.notes.length > 0 && (
                            <div
                              className="mt-0.5 flex items-center gap-1 text-xs text-warning"
                              title={l.notes.join('\n')}
                            >
                              <AlertTriangle className="size-3" /> {l.notes.length} known gap
                              {l.notes.length > 1 ? 's' : ''}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {l.homes.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {l.commercial ? l.commercial.toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {compactMoney(l.totalMarketValue)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {l.medianMarketValue ? compactMoney(l.medianMarketValue) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <Missing v={l.missing.area} />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <Missing v={l.missing.yearBuilt} />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <Missing v={l.missing.grade} />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <Missing v={l.missing.owner} />
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {pct(l.homesteadPct)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {pct(l.taxCeilingPct)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {pct(l.equityIndexedPct)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <RateCell l={l} />
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {formatDateTime(l.loadedAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {selected && (
            <CountyDetail load={selected} detail={detail.data} error={detail.error?.message} />
          )}
        </div>
      )}
    </>
  );
}

function CountyDetail({
  load,
  detail,
  error,
}: {
  load: CadLoadSummary;
  detail: PlatformCountyDetail | undefined;
  error?: string;
}) {
  if (error) return <Alert variant="destructive">{error}</Alert>;
  return (
    <section aria-label={`${load.countyName} detail`} className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {load.countyName} County, {load.taxYear}
        </h2>
        <p className="max-w-3xl text-xs text-muted-foreground">Source: {load.source}</p>
      </div>
      {load.notes.map((n) => (
        <div
          key={n}
          className="flex gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>{n}</span>
        </div>
      ))}
      {!detail ? (
        <Skeleton className="h-80 w-full" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile
              label="Tax-rate coverage"
              value={
                detail.rateCoveragePct === null ? '—' : `${detail.rateCoveragePct.toFixed(1)}%`
              }
            />
            {detail.classes.map((c) => (
              <Tile
                key={c.stateClass}
                label={`Class ${c.stateClass}`}
                value={c.count.toLocaleString()}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Tax-rate coverage is the share of each parcel’s taxing units that have a 2026 rate,
            weighted by parcels. Units without a rate make dollar savings read low.
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Market value</CardTitle>
                <CardDescription>Parcels by appraisal district market value.</CardDescription>
              </CardHeader>
              <CardContent>
                <BarList
                  ariaLabel="Parcels by market value"
                  data={detail.marketValue.map((b) => ({ label: b.label, value: b.count }))}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Vs neighbors</CardTitle>
                <CardDescription>
                  Improvement value per sq ft against comparable neighbors. Red = appraised above
                  neighbors (protest candidates); blue = below.
                  {` ${detail.equity.find((e) => e.label === 'Not indexed')?.count.toLocaleString() ?? 0} parcels have too few comparables to index.`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BarList
                  ariaLabel="Parcels by appraisal compared with neighbors"
                  data={detail.equity
                    .filter((e) => e.label !== 'Not indexed')
                    .map((e) => ({
                      label: e.label,
                      value: e.count,
                      color: EQUITY_COLORS[e.label],
                    }))}
                />
              </CardContent>
            </Card>
            {detail.buildingTypes.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Commercial building types</CardTitle>
                  <CardDescription>The 15 most common, by parcels.</CardDescription>
                </CardHeader>
                <CardContent>
                  <BarList
                    ariaLabel="Commercial parcels by building type"
                    data={detail.buildingTypes.map((b) => ({
                      label: b.propertyUse,
                      value: b.count,
                    }))}
                  />
                </CardContent>
              </Card>
            )}
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>Taxing units</CardTitle>
                <CardDescription>
                  {detail.units.length} units, most parcels first. Missing rates are flagged.
                </CardDescription>
              </CardHeader>
              <div className="max-h-[28rem] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 border-y bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Unit</th>
                      <th className="px-4 py-2 text-left font-medium">Kind</th>
                      <th className="px-4 py-2 text-right font-medium">Parcels</th>
                      <th className="px-4 py-2 text-right font-medium">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.units.map((u) => (
                      <tr key={u.code} className="border-b last:border-0">
                        <td className="px-4 py-2">
                          {u.name}
                          <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                            {u.code}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{u.kind}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {u.parcels.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {u.ratePct ? (
                            `${Number(u.ratePct).toFixed(4)}%`
                          ) : (
                            <Badge variant="warning">missing</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      )}
    </section>
  );
}
