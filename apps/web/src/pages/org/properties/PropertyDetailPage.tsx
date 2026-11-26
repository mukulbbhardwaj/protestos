import { roleAtLeast, type PropertyDetail } from '@app/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, MapPin, Plus, User, UserCog } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { StageBadge } from '@/components/data/StageBadge';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrg } from '@/hooks/useOrg';
import { useOrgQuery } from '@/hooks/useOrgQuery';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { PROPERTY_TYPE_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { EstimateCard } from '../calculator/EstimateCard';
import { computeFee } from './FeePreview';
import { PropertyHearingsCard } from './PropertyHearingsCard';
import { TaxYearEditor } from './TaxYearEditor';

const whole = (v: string | null | undefined) => (v ? formatMoney(v).replace(/\.00$/, '') : '—');

export function PropertyDetailPage() {
  const { propertyId = '' } = useParams();
  const org = useOrg();
  const qc = useQueryClient();
  const canEdit = roleAtLeast(org.role, 'STAFF');
  const { data: p, error, isPending } = useOrgQuery<PropertyDetail>(`/properties/${propertyId}`);
  const [chosenYear, setChosenYear] = useState<number | null>(null);

  const addYear = useMutation({
    mutationFn: (taxYear: number) =>
      api(`/orgs/${org.orgSlug}/properties/${propertyId}/tax-years`, {
        method: 'POST',
        body: { taxYear },
      }),
    onSuccess: (_d, taxYear) => {
      toast.success(`${taxYear} record added.`);
      setChosenYear(taxYear);
      void qc.invalidateQueries({ queryKey: ['org', org.orgSlug] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (error) return <Alert variant="destructive">{error.message}</Alert>;
  if (isPending || !p) return <Skeleton className="h-64 w-full" />;

  const ctx = p.feeContext;
  const selected = p.taxYears.find((t) => t.taxYear === chosenYear) ?? p.taxYears[0] ?? null;
  const latest = p.taxYears[0]?.taxYear ?? ctx.currentTaxYear - 1;
  const nextYear = Math.max(latest + 1, ctx.currentTaxYear);
  const basis = ctx.savingsBasis === 'MARKET' ? 'market' : 'appraised';

  return (
    <>
      <Link
        to={`/${org.orgSlug}/properties`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Properties
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{p.accountNumber}</h1>
            <Badge variant="secondary">{p.county.name} County</Badge>
            <Badge variant="outline">{PROPERTY_TYPE_LABELS[p.propertyType]}</Badge>
            {p.archivedAt && <Badge variant="outline">Archived</Badge>}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground [&_svg]:size-3.5">
            <span className="inline-flex items-center gap-1.5">
              <MapPin /> {p.situsLine ?? 'No address on file'}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <User />
              <Link
                to={`/${org.orgSlug}/contacts/${p.contact.id}`}
                className="font-medium text-primary hover:underline"
              >
                {p.contact.displayName}
              </Link>
              {p.contact.clientNumber && <span>#{p.contact.clientNumber}</span>}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <UserCog /> {p.consultant?.name ?? 'No consultant'}
            </span>
          </div>
        </div>
        {p.county.cadWebsite && (
          <Button asChild variant="outline" size="sm">
            <a href={p.county.cadWebsite} target="_blank" rel="noreferrer">
              {p.county.cadName} <ExternalLink />
            </a>
          </Button>
        )}
      </div>

      <EstimateCard countyId={p.county.id} accountNumber={p.accountNumber} />

      <PropertyHearingsCard
        propertyId={p.id}
        label={`${p.county.name} ${p.accountNumber} · ${p.contact.displayName}`}
        archived={Boolean(p.archivedAt)}
      />

      <Card className="mb-6 overflow-hidden">
        <CardHeader className="flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Tax years</CardTitle>
            <CardDescription>
              Savings are measured on {basis} value. Select a year to edit it.
            </CardDescription>
          </div>
          {canEdit && !p.archivedAt && !p.taxYears.some((t) => t.taxYear === nextYear) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => addYear.mutate(nextYear)}
              disabled={addYear.isPending}
            >
              <Plus /> Add {nextYear}
            </Button>
          )}
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-2.5 text-left font-medium">Year</th>
                <th className="px-5 py-2.5 text-left font-medium">Stage</th>
                <th className="px-5 py-2.5 text-right font-medium">Notice ({basis})</th>
                <th className="px-5 py-2.5 text-right font-medium">Final ({basis})</th>
                <th className="px-5 py-2.5 text-right font-medium">Reduction</th>
                <th className="px-5 py-2.5 text-right font-medium">Fee</th>
              </tr>
            </thead>
            <tbody>
              {p.taxYears.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                    No tax years yet.
                  </td>
                </tr>
              )}
              {p.taxYears.map((t) => {
                const { result } = computeFee(ctx, t);
                const isSelected = selected?.id === t.id;
                return (
                  <tr
                    key={t.id}
                    onClick={() => setChosenYear(t.taxYear)}
                    aria-selected={isSelected}
                    className={cn(
                      'cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/40',
                      isSelected &&
                        'bg-primary/5 shadow-[inset_3px_0_0_var(--primary)] hover:bg-primary/5',
                    )}
                  >
                    <td className="px-5 py-3 font-medium">
                      {t.taxYear}
                      {t.taxYear === ctx.currentTaxYear && (
                        <Badge variant="outline" className="ml-2">
                          Current
                        </Badge>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <StageBadge stage={t.protestStage} />
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {whole(ctx.savingsBasis === 'MARKET' ? t.noticeMarket : t.noticeAppraised)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {whole(ctx.savingsBasis === 'MARKET' ? t.finalMarket : t.finalAppraised)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                      {whole(result.reduction)}
                    </td>
                    <td className="px-5 py-3 text-right font-medium tabular-nums">
                      {result.total ? formatMoney(result.total) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {selected && (
        <TaxYearEditor
          key={selected.id}
          record={selected}
          feeContext={ctx}
          events={p.stageEvents.filter((e) => e.taxYear === selected.taxYear)}
          canEdit={canEdit && !p.archivedAt}
        />
      )}
    </>
  );
}
