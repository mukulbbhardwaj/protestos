import { calculateFee, resolveFeeTerms, type FeeContext, type FeeSource } from '@app/shared';
import { AlertTriangle, Calculator } from 'lucide-react';
import { formatMoney } from '@/lib/format';

const SOURCE: Record<FeeSource, string> = {
  TAX_YEAR: 'this year',
  PROPERTY: 'property',
  CLIENT: 'client',
  FIRM: 'firm default',
};

type Raw = string | number | null | undefined;

export interface FeeValues {
  taxYear: number;
  noticeMarket?: Raw;
  finalMarket?: Raw;
  noticeAppraised?: Raw;
  finalAppraised?: Raw;
  taxRatePct?: Raw;
  contingencyPctOverride?: Raw;
  bppFee?: Raw;
  bppRenderedAt?: Raw;
}

/** Form text → a plain decimal string, or null while it isn't a number yet. */
const clean = (v: Raw) => {
  const t = String(v ?? '').replace(/[$,\s]/g, '');
  return /^\d+(\.\d+)?$/.test(t) ? t : null;
};

/** Runs the same shared fee engine as the API, so the preview matches the invoice. */
export function computeFee(ctx: FeeContext, v: FeeValues) {
  const terms = resolveFeeTerms({
    taxYear: {
      contingencyPctOverride: clean(v.contingencyPctOverride),
      bppFee: clean(v.bppFee),
      bppRenderedAt: v.bppRenderedAt || null,
    },
    property: ctx.property,
    client: ctx.client,
    firm: ctx.firm,
  });
  const result = calculateFee({
    noticeMarket: clean(v.noticeMarket),
    finalMarket: clean(v.finalMarket),
    noticeAppraised: clean(v.noticeAppraised),
    finalAppraised: clean(v.finalAppraised),
    taxRatePct: clean(v.taxRatePct),
    contingencyPct: terms.contingencyPct.value,
    flatFee: terms.flatFee.value,
    bppFee: terms.bppFee?.value ?? '0',
    applyFlatFee: !ctx.flatFeeCurrentYearOnly || v.taxYear === ctx.currentTaxYear,
    savingsBasis: ctx.savingsBasis,
  });
  return { terms, result };
}

export function FeePreview({ ctx, values }: { ctx: FeeContext; values: FeeValues }) {
  const { terms, result } = computeFee(ctx, values);
  const rows: [string, string | null, string?][] = [
    [
      `Reduction (${ctx.savingsBasis === 'MARKET' ? 'market' : 'appraised'})`,
      result.reduction && formatMoney(result.reduction),
    ],
    ['Tax savings', result.taxableSavings && formatMoney(result.taxableSavings)],
    [
      `Contingency ${Number(terms.contingencyPct.value)}%`,
      result.contingencyFee && formatMoney(result.contingencyFee),
      SOURCE[terms.contingencyPct.source],
    ],
    ...(Number(result.flatFee) > 0
      ? [
          ['Flat fee', formatMoney(result.flatFee), SOURCE[terms.flatFee.source]] as [
            string,
            string,
            string,
          ],
        ]
      : []),
    ...(terms.bppFee
      ? [
          ['BPP rendition fee', formatMoney(result.bppFee), SOURCE[terms.bppFee.source]] as [
            string,
            string,
            string,
          ],
        ]
      : []),
  ];
  return (
    <div className="rounded-xl border bg-card p-5 shadow-xs">
      <p className="mb-3 flex items-center gap-1.5 text-sm font-medium">
        <Calculator className="size-4 text-primary" /> Fee preview
      </p>
      <dl className="space-y-1.5 text-sm">
        {rows.map(([label, value, source]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">
              {label}
              {source && <span className="ml-1 text-xs opacity-70">({source})</span>}
            </dt>
            <dd className="tabular-nums">{value ?? '—'}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 border-t pt-2 font-semibold">
          <dt>Total fee</dt>
          <dd className="tabular-nums" data-testid="fee-total">
            {result.total ? formatMoney(result.total) : '—'}
          </dd>
        </div>
      </dl>
      {result.status === 'READY' && result.explanation[0]?.startsWith('Reduction') && (
        <p className="mt-3 text-xs text-muted-foreground">{result.explanation[0]}</p>
      )}
      {result.status === 'INCOMPLETE' && (
        <p className="mt-3 text-xs text-muted-foreground">
          Needs{' '}
          {result.missing
            .map(
              (m) =>
                ({
                  noticeValue: 'the notice value',
                  finalValue: 'the final value',
                  taxRate: 'the tax rate',
                })[m],
            )
            .join(', ')}{' '}
          before it can be invoiced.
        </p>
      )}
      {result.warnings.map((w) => (
        <p key={w} className="mt-2 flex gap-1.5 text-xs text-warning">
          <AlertTriangle className="size-3.5 shrink-0" />
          {w}
        </p>
      ))}
    </div>
  );
}
