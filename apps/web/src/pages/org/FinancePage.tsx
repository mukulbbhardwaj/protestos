import {
  PAYMENT_METHODS,
  PROPERTY_TYPES,
  type AgingBucket,
  type FinanceDashboard,
} from '@app/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, Table2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BarList } from '@/components/charts/BarList';
import { GroupedColumns } from '@/components/charts/GroupedColumns';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrg } from '@/hooks/useOrg';
import { useConsultants, useCounties } from '@/hooks/useReference';
import { qs, useUrlState } from '@/hooks/useUrlState';
import { api } from '@/lib/api';
import { METHOD_LABELS } from '@/lib/billing';
import { downloadCsv } from '@/lib/csv';
import { formatDay, formatMoney } from '@/lib/format';
import { PROPERTY_TYPE_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';

const KEYS = [
  'from',
  'to',
  'taxYear',
  'countyId',
  'consultantId',
  'propertyType',
  'method',
] as const;
const AGING_LABELS: Record<AgingBucket, string> = {
  NOT_DUE: 'Not yet due',
  '0-30': '1–30 days late',
  '31-60': '31–60 days late',
  '61-90': '61–90 days late',
  '90+': 'Over 90 days late',
};
const compact = (v: number) =>
  v >= 1000 ? `$${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k` : `$${v}`;
const monthLabel = (m: string) =>
  new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });

/** BUILD_PLAN 8.10 finance dashboard (owners and admins). */
export function FinancePage() {
  const org = useOrg();
  const counties = useCounties();
  const consultants = useConsultants();
  const { values, set } = useUrlState(KEYS);
  const q = useQuery({
    queryKey: ['org', org.orgSlug, 'finance', values],
    queryFn: () => api<FinanceDashboard>(`/orgs/${org.orgSlug}/finance/dashboard${qs(values)}`),
    placeholderData: keepPreviousData,
  });
  const d = q.data;
  const thisYear = new Date().getFullYear();

  return (
    <>
      <PageHeader
        title="Finance"
        description="Billed by invoice date, collected by payment date. Tax year means protest year."
      />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Input
          aria-label="From"
          type="date"
          className="w-auto"
          value={values.from}
          onChange={(e) => set({ from: e.target.value })}
        />
        <span className="text-sm text-muted-foreground">to</span>
        <Input
          aria-label="To"
          type="date"
          className="w-auto"
          value={values.to}
          onChange={(e) => set({ to: e.target.value })}
        />
        <NativeSelect
          aria-label="Tax year"
          className="w-auto"
          value={values.taxYear}
          onChange={(e) => set({ taxYear: e.target.value })}
        >
          <option value="">All tax years</option>
          {Array.from({ length: 5 }, (_, i) => thisYear - i).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="County"
          className="w-auto"
          value={values.countyId}
          onChange={(e) => set({ countyId: e.target.value })}
        >
          <option value="">All counties</option>
          {counties.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Consultant"
          className="w-auto"
          value={values.consultantId}
          onChange={(e) => set({ consultantId: e.target.value })}
        >
          <option value="">All consultants</option>
          {consultants.data?.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Property type"
          className="w-auto"
          value={values.propertyType}
          onChange={(e) => set({ propertyType: e.target.value })}
        >
          <option value="">All property types</option>
          {PROPERTY_TYPES.map((t) => (
            <option key={t} value={t}>
              {PROPERTY_TYPE_LABELS[t]}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Payment method"
          className="w-auto"
          value={values.method}
          onChange={(e) => set({ method: e.target.value })}
        >
          <option value="">All payment methods</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {METHOD_LABELS[m]}
            </option>
          ))}
        </NativeSelect>
        {Object.values(values).some(Boolean) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => set(Object.fromEntries(KEYS.map((k) => [k, null])))}
          >
            Clear
          </Button>
        )}
      </div>

      {q.error && (
        <Alert variant="destructive" className="mb-6">
          {q.error.message}
        </Alert>
      )}
      {!d ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className={cn('grid gap-6', q.isPlaceholderData && 'opacity-60')}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <PeriodTile label="This month" v={d.kpis.thisMonth} />
            <PeriodTile label="Last month" v={d.kpis.lastMonth} />
            <PeriodTile label="Year to date" v={d.kpis.ytd} />
            <PeriodTile label="Last year" v={d.kpis.lastYear} />
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Collection rate</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {d.kpis.collectionRateYtd ? `${d.kpis.collectionRateYtd}%` : '—'}
              </p>
              <p className="text-xs text-muted-foreground">Collected ÷ billed, year to date</p>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Outstanding {formatMoney(d.outstanding.total)}</CardTitle>
                <CardDescription>
                  {d.outstanding.count} open {d.outstanding.count === 1 ? 'invoice' : 'invoices'},
                  by how late they are.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BarList
                  ariaLabel="Outstanding by days past due"
                  data={(Object.keys(AGING_LABELS) as AgingBucket[]).map((b) => ({
                    label: AGING_LABELS[b],
                    value: Number(d.outstanding.buckets[b]),
                  }))}
                  format={(v) => formatMoney(v)}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{d.savings.taxYear} results for clients</CardTitle>
                <CardDescription>
                  From final values on {d.savings.properties.toLocaleString()} property-years.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Value reduced</p>
                  <p className="text-2xl font-semibold tabular-nums">
                    {formatMoney(d.savings.valueReduced)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Tax saved</p>
                  <p className="text-2xl font-semibold tabular-nums">
                    {formatMoney(d.savings.taxSavings)}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <MonthlyCard d={d} />

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle>Billed by county</CardTitle>
                  <CardDescription>
                    {formatDay(d.range.from)} – {formatDay(d.range.to)}
                  </CardDescription>
                </div>
                <ExportButton
                  onClick={() =>
                    downloadCsv(
                      'billed-by-county',
                      ['County', 'Billed'],
                      d.byCounty.map((c) => [c.county, c.billed]),
                    )
                  }
                />
              </CardHeader>
              <CardContent>
                {d.byCounty.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing billed in this range.</p>
                ) : (
                  <BarList
                    ariaLabel="Billed by county"
                    data={d.byCounty.map((c) => ({ label: c.county, value: Number(c.billed) }))}
                    format={(v) => formatMoney(v)}
                  />
                )}
              </CardContent>
            </Card>
            <Card className="overflow-hidden">
              <CardHeader className="flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle>Protest outcomes</CardTitle>
                  <CardDescription>Property-years by result.</CardDescription>
                </div>
                <ExportButton
                  onClick={() =>
                    downloadCsv(
                      'protest-outcomes',
                      [
                        'Tax year',
                        'Settled',
                        'Board order',
                        'No change',
                        'Withdrawn',
                        'No result yet',
                      ],
                      d.outcomes.map((o) => [
                        o.taxYear,
                        o.settled,
                        o.boardOrder,
                        o.noChange,
                        o.withdrawn,
                        o.pending,
                      ]),
                    )
                  }
                />
              </CardHeader>
              <SimpleTable
                head={[
                  'Tax year',
                  'Settled',
                  'Board order',
                  'No change',
                  'Withdrawn',
                  'No result yet',
                ]}
                rows={d.outcomes.map((o) => [
                  String(o.taxYear),
                  ...[o.settled, o.boardOrder, o.noChange, o.withdrawn, o.pending].map((v) =>
                    v.toLocaleString(),
                  ),
                ])}
              />
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <CardHeader className="flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle>Largest balances</CardTitle>
                  <CardDescription>Clients who owe the most.</CardDescription>
                </div>
                <ExportButton
                  onClick={() =>
                    downloadCsv(
                      'largest-balances',
                      ['Client', 'Client #', 'Invoices', 'Past due', 'Balance'],
                      d.topOutstanding.map((c) => [
                        c.contact.displayName,
                        c.contact.clientNumber,
                        c.invoices,
                        c.pastDue,
                        c.balance,
                      ]),
                    )
                  }
                />
              </CardHeader>
              <SimpleTable
                head={['Client', 'Invoices', 'Past due', 'Balance']}
                rows={d.topOutstanding.map((c) => [
                  <Link
                    key="c"
                    to={`/${org.orgSlug}/contacts/${c.contact.id}`}
                    className="text-primary hover:underline"
                  >
                    {c.contact.displayName}
                  </Link>,
                  c.invoices,
                  formatMoney(c.pastDue),
                  formatMoney(c.balance),
                ])}
                empty="Nobody owes anything."
              />
            </Card>
            <Card className="overflow-hidden">
              <CardHeader className="flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle>Recent payments</CardTitle>
                  <CardDescription>The latest received in the range.</CardDescription>
                </div>
                <ExportButton
                  onClick={() =>
                    downloadCsv(
                      'recent-payments',
                      ['Received', 'Client', 'Method', 'Reference', 'Amount'],
                      d.recentPayments.map((p) => [
                        p.receivedAt,
                        p.contact.displayName,
                        METHOD_LABELS[p.method],
                        p.reference,
                        p.amount,
                      ]),
                    )
                  }
                />
              </CardHeader>
              <SimpleTable
                head={['Received', 'Client', 'Method', 'Amount']}
                rows={d.recentPayments.map((p) => [
                  formatDay(p.receivedAt),
                  p.contact.displayName,
                  METHOD_LABELS[p.method],
                  formatMoney(p.amount),
                ])}
                empty="No payments in this range."
              />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function PeriodTile({ label, v }: { label: string; v: { billed: string; collected: string } }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(v.billed)}</p>
      <p className="text-xs text-muted-foreground">
        billed · <span className="tabular-nums text-foreground">{formatMoney(v.collected)}</span>{' '}
        collected
      </p>
    </Card>
  );
}

function MonthlyCard({ d }: { d: FinanceDashboard }) {
  const [table, setTable] = useState(false);
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Billed and collected by month</CardTitle>
          <CardDescription>The last 12 months.</CardDescription>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setTable(!table)} aria-pressed={table}>
            <Table2 /> {table ? 'Chart' : 'Table'}
          </Button>
          <ExportButton
            onClick={() =>
              downloadCsv(
                'billed-collected-by-month',
                ['Month', 'Billed', 'Collected'],
                d.monthly.map((m) => [m.month, m.billed, m.collected]),
              )
            }
          />
        </div>
      </CardHeader>
      {table ? (
        <SimpleTable
          head={['Month', 'Billed', 'Collected']}
          rows={d.monthly.map((m) => [m.month, formatMoney(m.billed), formatMoney(m.collected)])}
        />
      ) : (
        <CardContent>
          <GroupedColumns
            ariaLabel="Billed and collected by month"
            categories={d.monthly.map((m) => ({ key: m.month, label: monthLabel(m.month) }))}
            series={[
              { key: 'billed', label: 'Billed', color: 'var(--chart-1)' },
              { key: 'collected', label: 'Collected', color: 'var(--chart-2)' },
            ]}
            values={Object.fromEntries(
              d.monthly.map((m) => [
                m.month,
                { billed: Number(m.billed), collected: Number(m.collected) },
              ]),
            )}
            format={compact}
          />
        </CardContent>
      )}
    </Card>
  );
}

function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      <Download /> CSV
    </Button>
  );
}

function SimpleTable({
  head,
  rows,
  empty,
}: {
  head: string[];
  rows: React.ReactNode[][];
  empty?: string;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
        <tr>
          {head.map((h, i) => (
            <th
              key={h}
              className={cn('px-5 py-2 font-medium', i === 0 ? 'text-left' : 'text-right')}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={head.length} className="px-5 py-6 text-center text-muted-foreground">
              {empty ?? 'Nothing yet.'}
            </td>
          </tr>
        )}
        {rows.map((r, i) => (
          <tr key={i} className="border-b last:border-0">
            {r.map((c, j) => (
              <td
                key={j}
                className={cn('px-5 py-2 tabular-nums', j === 0 ? 'text-left' : 'text-right')}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
