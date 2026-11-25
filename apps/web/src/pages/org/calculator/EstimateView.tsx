import type { CalculatorEstimate } from '@app/shared';
import { AlertTriangle, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

export const whole = (v: string | null | undefined) =>
  v == null ? '—' : formatMoney(v).replace(/\.00$/, '');

const CONFIDENCE = {
  HIGH: { label: 'High confidence', variant: 'success' },
  MEDIUM: { label: 'Medium confidence', variant: 'secondary' },
  LOW: { label: 'Low confidence', variant: 'warning' },
} as const;

const SOURCE: Record<CalculatorEstimate['contingencySource'], string> = {
  TAX_YEAR: 'this year’s override',
  PROPERTY: 'property terms',
  CLIENT: 'client terms',
  FIRM: 'firm default',
  WHAT_IF: 'what-if',
};

export const DISCLAIMER =
  'Estimate from public appraisal district data. Not a guarantee of any result.';

export function ConfidenceBadge({ e }: { e: CalculatorEstimate['estimate'] }) {
  if (!e.confidence) return null;
  const c = CONFIDENCE[e.confidence];
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

function Tile({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div className={cn('rounded-lg border p-4', strong && 'border-primary/30 bg-primary/5')}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn('mt-1 text-2xl font-semibold tabular-nums', strong && 'text-primary')}
        data-testid={`tile-${label}`}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** Headline numbers for an estimate: also used by the property page card. */
export function EstimateTiles({ data }: { data: CalculatorEstimate }) {
  const e = data.estimate;
  const pct = `${Number(e.contingencyPct)}%`;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Tile
        label="Value reduction"
        value={whole(e.appraisedReduction)}
        hint={
          e.indicatedValue
            ? `${whole(data.parcel.appraisedValue)} → ${whole(e.newAppraised)}`
            : undefined
        }
      />
      <Tile label="Tax savings / year" value={whole(e.taxSavings)} strong />
      <Tile
        label={`Firm fee (${pct})`}
        value={whole(e.firmFee)}
        hint={SOURCE[data.contingencySource]}
      />
      <Tile label="Client keeps" value={whole(e.clientKeeps)} />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b py-1.5 text-sm last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  );
}

export function EstimateView({ data }: { data: CalculatorEstimate }) {
  const { parcel: p, estimate: e } = data;
  const hasEstimate = e.status === 'ESTIMATE' || e.status === 'NO_REDUCTION';
  const commercial = p.kind === 'COMMERCIAL';
  return (
    <div className="space-y-6">
      {hasEstimate && <EstimateTiles data={data} />}

      {(e.status !== 'ESTIMATE' || e.warnings.length > 0) && (
        <div className="space-y-2">
          {e.status !== 'ESTIMATE' && (
            <div className="flex gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
              <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>{e.explanation.at(-1)}</span>
            </div>
          )}
          {e.warnings.map((w) => (
            <div
              key={w}
              className="flex gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Appraisal district record</CardTitle>
            <CardDescription>
              {data.county.name} CAD, {data.taxYear} roll
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl>
              <Fact label="Market value" value={whole(p.marketValue)} />
              <Fact label="Appraised (capped)" value={whole(p.appraisedValue)} />
              <Fact label="Land" value={whole(p.landValue)} />
              <Fact label="Improvements" value={whole(p.improvementValue)} />
              {commercial && <Fact label="Building type" value={p.propertyUse ?? '—'} />}
              <Fact
                label={commercial ? 'Building area' : 'Living area'}
                value={p.livingAreaSqft ? `${p.livingAreaSqft.toLocaleString()} sq ft` : '—'}
              />
              <Fact label="Year built" value={p.yearBuilt ?? '—'} />
              <Fact label="Grade" value={p.qualityCode ?? '—'} />
              <Fact label="Neighborhood" value={p.neighborhoodCode} />
              {commercial && p.marketArea && <Fact label="Market area" value={p.marketArea} />}
              {!commercial && (
                <Fact
                  label="Exemptions"
                  value={
                    [p.homestead && 'Homestead', p.taxCeiling && 'Over-65 / disabled']
                      .filter(Boolean)
                      .join(', ') || 'None'
                  }
                />
              )}
            </dl>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>How it was worked out</CardTitle>
              <CardDescription>
                {commercial
                  ? 'Unequal appraisal (Texas Tax Code §42.26): the median of comparable buildings of the same type, adjusted to this property’s land and building size. Commercial protests are often argued on income too; this uses only the appraisal district’s own values.'
                  : 'Unequal appraisal (Texas Tax Code §42.26): the median of comparable neighbors, adjusted to this home’s land and size.'}
              </CardDescription>
            </div>
            <ConfidenceBadge e={e} />
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {e.explanation.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
            {e.units.length > 0 && (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 text-left font-medium">Taxing unit</th>
                    <th className="py-2 text-right font-medium">Rate</th>
                    <th className="py-2 text-right font-medium">Taxable reduction</th>
                    <th className="py-2 text-right font-medium">Savings</th>
                  </tr>
                </thead>
                <tbody>
                  {e.units.map((u) => (
                    <tr key={u.code} className="border-b last:border-0">
                      <td className="py-2">
                        {u.name}
                        {u.note && <div className="text-xs text-muted-foreground">{u.note}</div>}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {Number(u.ratePct).toFixed(4)}%
                      </td>
                      <td className="py-2 text-right tabular-nums">{whole(u.taxableReduction)}</td>
                      <td className="py-2 text-right font-medium tabular-nums">
                        {formatMoney(u.savings)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      {e.comps.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>
              {commercial ? 'Comparable properties' : 'Comparable neighbors'} ({e.comps.length})
            </CardTitle>
            <CardDescription>
              {commercial ? (
                <>
                  Same building type ({p.propertyUse ?? 'commercial'})
                  {e.widened ? ' across the market area' : ' in the same neighborhood'}, similar
                  size and age. Adjusted value = this property’s land + the comparable’s improvement
                  value per sq ft × this building’s area.
                </>
              ) : (
                <>
                  Same neighborhood and property class
                  {e.widened ? ', widened to more varied homes' : ', similar size, age and grade'}.
                  Adjusted value = this home’s land + the neighbor’s improvement value per sq ft ×
                  this home’s area.
                </>
              )}{' '}
              Median: <strong>{whole(e.indicatedValue)}</strong>
              {e.dispersionPct && <> · spread {Number(e.dispersionPct).toFixed(1)}%</>}
            </CardDescription>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5 text-left font-medium">Account</th>
                  <th className="px-5 py-2.5 text-left font-medium">Address</th>
                  <th className="px-5 py-2.5 text-right font-medium">Area</th>
                  <th className="px-5 py-2.5 text-right font-medium">Built</th>
                  <th className="px-5 py-2.5 text-left font-medium">Grade</th>
                  <th className="px-5 py-2.5 text-right font-medium">Market</th>
                  <th className="px-5 py-2.5 text-right font-medium">Impr. $/sq ft</th>
                  <th className="px-5 py-2.5 text-right font-medium">Adjusted</th>
                </tr>
              </thead>
              <tbody>
                {e.comps.map((c) => (
                  <tr key={c.accountNumber} className="border-b last:border-0">
                    <td className="px-5 py-2.5 font-mono text-xs">{c.accountNumber}</td>
                    <td className="px-5 py-2.5">{c.situsLine ?? '—'}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">
                      {c.livingAreaSqft.toLocaleString()}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{c.yearBuilt ?? '—'}</td>
                    <td className="px-5 py-2.5">{c.qualityCode ?? '—'}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{whole(c.marketValue)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">
                      {formatMoney(c.improvementPerSqft)}
                    </td>
                    <td className="px-5 py-2.5 text-right font-medium tabular-nums">
                      {whole(c.adjustedValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">{DISCLAIMER}</p>
    </div>
  );
}
