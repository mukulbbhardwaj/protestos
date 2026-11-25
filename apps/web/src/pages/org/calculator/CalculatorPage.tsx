import {
  roleAtLeast,
  type CadParcelSummary,
  type CalculatorCoverage,
  type CalculatorEstimate,
} from '@app/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Loader2, MapPin, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { SearchInput } from '@/components/data/SearchInput';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, NativeSelect } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrg } from '@/hooks/useOrg';
import { useOrgQuery } from '@/hooks/useOrgQuery';
import { qs, useUrlState } from '@/hooks/useUrlState';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { BROWSE_KEYS, BrowsePanel } from './BrowsePanel';
import { ConfidenceBadge, EstimateView, whole } from './EstimateView';

const KEYS = ['county', 'year', 'view', 'q', 'account', 'pct', ...BROWSE_KEYS] as const;

/** "SMITH JANE & JOHN" → "Smith Jane & John", a starting point for the prospect's name. */
const titleCase = (s: string | null) =>
  (s ?? '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function CalculatorPage() {
  const { values, set, page } = useUrlState(KEYS);
  // Browse (filters) is the default; a search term switches to Search.
  const view = values.view === 'search' || (!values.view && values.q) ? 'search' : 'browse';
  const coverage = useOrgQuery<CalculatorCoverage>('/calculator/coverage');

  const counties = coverage.data ?? [];
  const county = counties.find((c) => String(c.countyId) === values.county) ?? counties[0];
  const taxYear =
    county?.taxYears.find((y) => String(y) === values.year) ?? county?.taxYears[0] ?? null;

  if (coverage.error) return <Alert variant="destructive">{coverage.error.message}</Alert>;

  return (
    <>
      <PageHeader
        title="Savings calculator"
        description="Estimate what a protest would save any home or commercial property, from the appraisal district’s own roll."
      />
      {coverage.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : !county || !taxYear ? (
        <Card>
          <CardHeader>
            <CardTitle>No appraisal roll loaded yet</CardTitle>
            <CardDescription>
              The calculator needs a county’s public appraisal roll. Harris County is supported
              first; ask your platform admin to load it.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <NativeSelect
              aria-label="County"
              className="w-44"
              value={county.countyId}
              onChange={(e) =>
                set({
                  county: e.target.value,
                  year: null,
                  account: null,
                  use: null,
                  hood: null,
                  grade: null,
                })
              }
            >
              {counties.map((c) => (
                <option key={c.countyId} value={c.countyId}>
                  {c.countyName} County
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Tax year"
              className="w-28"
              value={taxYear}
              onChange={(e) => set({ year: e.target.value, account: null })}
            >
              {county.taxYears.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </NativeSelect>
            <div
              className="flex rounded-md border p-0.5"
              role="tablist"
              aria-label="Find properties"
            >
              {(['browse', 'search'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => set({ view: v, account: null })}
                  className={cn(
                    'rounded px-3 py-1 text-sm capitalize',
                    view === v
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {v === 'browse' ? 'Browse & filter' : 'Search'}
                </button>
              ))}
            </div>
            {view === 'search' && (
              <SearchInput
                value={values.q}
                onChange={(q) => set({ q, account: null })}
                placeholder="Account number, address or owner"
              />
            )}
          </div>

          {values.account ? (
            <Estimate
              countyId={county.countyId}
              taxYear={taxYear}
              account={values.account}
              pct={values.pct}
              onPct={(pct) => set({ pct })}
              onBack={() => set({ account: null, pct: null })}
            />
          ) : view === 'browse' ? (
            <BrowsePanel
              countyId={county.countyId}
              taxYear={taxYear}
              values={values}
              page={page}
              set={set}
              onPick={(account) => set({ account, page: page })}
            />
          ) : (
            <Results
              countyId={county.countyId}
              taxYear={taxYear}
              q={values.q}
              onPick={(account) => set({ account })}
            />
          )}
        </>
      )}
    </>
  );
}

function Results({
  countyId,
  taxYear,
  q,
  onPick,
}: {
  countyId: number;
  taxYear: number;
  q: string;
  onPick: (account: string) => void;
}) {
  const ready = q.trim().length >= 2;
  const { data, isPending, error } = useOrgQuery<CadParcelSummary[]>(
    `/calculator/search${qs({ countyId, taxYear, q })}`,
    { enabled: ready },
  );
  if (!ready) {
    return (
      <p className="text-sm text-muted-foreground">
        Search every home and commercial property in the county, not just your clients: an account
        number, a street address, or an owner’s name.
      </p>
    );
  }
  if (error) return <Alert variant="destructive">{error.message}</Alert>;
  if (isPending) return <Skeleton className="h-40 w-full" />;
  if (data.length === 0) {
    return (
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>No homes or commercial properties match “{q}”.</p>
        <p>
          The calculator covers single-family homes (state class A1) and, where the appraisal
          district publishes building types, commercial property (F1). Multi-family, land and
          business personal property accounts aren’t included yet.
        </p>
      </div>
    );
  }
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y" aria-label="Accounts found">
        {data.map((p) => (
          <li key={p.accountNumber}>
            <button
              type="button"
              onClick={() => onPick(p.accountNumber)}
              className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-3 text-left hover:bg-muted/40"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium">
                  <MapPin className="size-3.5 text-muted-foreground" />
                  {p.situsLine ?? 'No situs address'}
                  {p.situsZip && <span className="text-muted-foreground">{p.situsZip}</span>}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  <span className="font-mono">{p.accountNumber}</span> ·{' '}
                  {p.ownerName ?? 'Unknown owner'} · class {p.stateClass}
                </div>
              </div>
              <div className="text-right text-sm tabular-nums">
                <div className="font-medium">{whole(p.marketValue)}</div>
                <div className="text-xs text-muted-foreground">market value</div>
              </div>
            </button>
          </li>
        ))}
      </ul>
      {data.length === 20 && (
        <p className="border-t px-5 py-2 text-xs text-muted-foreground">
          Showing the first 20 matches. Type more to narrow it down.
        </p>
      )}
    </Card>
  );
}

function Estimate({
  countyId,
  taxYear,
  account,
  pct,
  onPct,
  onBack,
}: {
  countyId: number;
  taxYear: number;
  account: string;
  pct: string;
  onPct: (pct: string) => void;
  onBack: () => void;
}) {
  const org = useOrg();
  const canCreate = roleAtLeast(org.role, 'STAFF');
  const [creating, setCreating] = useState(false);
  const { data, isPending, error } = useOrgQuery<CalculatorEstimate>(
    `/calculator/estimate${qs({ countyId, taxYear, account, contingencyPct: pct })}`,
  );

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to results
      </button>
      {error ? (
        <Alert variant="destructive">{error.message}</Alert>
      ) : isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold tracking-tight">
                  {data.parcel.situsLine ?? data.parcel.accountNumber}
                </h2>
                <ConfidenceBadge e={data.estimate} />
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                <span className="font-mono">{data.parcel.accountNumber}</span> ·{' '}
                {data.parcel.ownerName ?? 'Unknown owner'} · {data.county.name} County,{' '}
                {data.taxYear}
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-muted-foreground">
                Contingency %
                <Input
                  key={data.estimate.contingencyPct}
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  className="mt-1 w-24"
                  defaultValue={Number(data.estimate.contingencyPct)}
                  onBlur={(e) => {
                    const v = e.target.value;
                    if (v !== '' && Number(v) !== Number(data.estimate.contingencyPct)) onPct(v);
                  }}
                  aria-label="Contingency percent"
                />
              </label>
              {data.property ? (
                <Button asChild variant="outline">
                  <Link to={`/${org.orgSlug}/properties/${data.property.id}`}>
                    Open {data.property.archived ? 'archived ' : ''}property (
                    {data.property.contactName}) <ExternalLink />
                  </Link>
                </Button>
              ) : (
                canCreate && (
                  <Button onClick={() => setCreating(true)}>
                    <UserPlus /> Create prospect
                  </Button>
                )
              )}
            </div>
          </div>
          <EstimateView data={data} />
          <CreateProspectDialog open={creating} onOpenChange={setCreating} data={data} />
        </>
      )}
    </>
  );
}

function CreateProspectDialog({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  data: CalculatorEstimate;
}) {
  const org = useOrg();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(titleCase(data.parcel.ownerName));
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api<{ contactId: number; propertyId: number }>(`/orgs/${org.orgSlug}/calculator/prospect`, {
        method: 'POST',
        body: {
          countyId: data.county.id,
          taxYear: data.taxYear,
          account: data.parcel.accountNumber,
          displayName,
          email,
          phone,
        },
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['org', org.orgSlug] });
      toast.success('Prospect added with this property.');
      onOpenChange(false);
      navigate(`/${org.orgSlug}/contacts/${r.contactId}`);
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create prospect</DialogTitle>
          <DialogDescription>
            Adds a prospect with account {data.parcel.accountNumber} as their property and the{' '}
            {data.taxYear} roll values as notice values.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Name" htmlFor="p-name">
            <Input
              id="p-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </Field>
          <Field label="Email (optional)" htmlFor="p-email">
            <Input
              id="p-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Phone (optional)" htmlFor="p-phone">
            <Input id="p-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          {data.estimate.taxSavings && Number(data.estimate.taxSavings) > 0 && (
            <p className="rounded-md bg-muted/50 p-3 text-sm">
              Estimated savings: <strong>{whole(data.estimate.taxSavings)}</strong> a year.
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !displayName.trim()}>
              {create.isPending && <Loader2 className="animate-spin" />} Create prospect
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
