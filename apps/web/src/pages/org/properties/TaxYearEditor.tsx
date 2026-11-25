import {
  PROTEST_STAGES,
  RESULT_TYPES,
  SYSTEM_STAGES,
  UpdateTaxYearInput,
  type FeeContext,
  type ProtestStage,
  type StageEvent,
  type TaxYearRecord,
} from '@app/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { StageBadge } from '@/components/data/StageBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, NativeSelect } from '@/components/ui/input';
import { formatAmount, MoneyInput } from '@/components/ui/money-input';
import { useOrg } from '@/hooks/useOrg';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { STAGE_LABELS } from '@/lib/labels';
import { computeFee, FeePreview } from './FeePreview';

type FormIn = z.input<typeof UpdateTaxYearInput>;
type FormOut = z.output<typeof UpdateTaxYearInput>;

const VALUE_ROWS = [
  ['Land', 'noticeLand', 'finalLand'],
  ['Improvements', 'noticeImprovement', 'finalImprovement'],
  ['Market', 'noticeMarket', 'finalMarket'],
  ['Appraised', 'noticeAppraised', 'finalAppraised'],
] as const;

const RESULT_LABELS: Record<(typeof RESULT_TYPES)[number], string> = {
  SETTLEMENT: 'Settlement',
  BOARD_ORDER: 'Board order',
  NO_CHANGE: 'No change',
  WITHDRAWN: 'Withdrawn',
};

/** "314920.00" → "314920" so the form holds plain numbers. */
const plain = (v: string | null) => (v ?? '').replace(/\.00$/, '');

function toForm(t: TaxYearRecord): FormIn {
  return {
    noticeLand: plain(t.noticeLand),
    noticeImprovement: plain(t.noticeImprovement),
    noticeMarket: plain(t.noticeMarket),
    noticeAppraised: plain(t.noticeAppraised),
    finalLand: plain(t.finalLand),
    finalImprovement: plain(t.finalImprovement),
    finalMarket: plain(t.finalMarket),
    finalAppraised: plain(t.finalAppraised),
    taxRatePct: t.taxRatePct ?? '',
    bppRenderedAt: t.bppRenderedAt ?? '',
    bppFee: plain(t.bppFee),
    underLitigation: t.underLitigation,
    underArbitration: t.underArbitration,
    homestead: t.homestead,
    noticeReceivedAt: t.noticeReceivedAt ?? '',
    protestFiledAt: t.protestFiledAt ?? '',
    resultType: t.resultType,
    resultAt: t.resultAt ?? '',
    contingencyPctOverride: t.contingencyPctOverride ?? '',
    notes: t.notes ?? '',
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function change(notice: unknown, final: unknown): string {
  const n = Number(String(notice ?? '').replace(/,/g, ''));
  const f = Number(String(final ?? '').replace(/,/g, ''));
  if (!notice || !final || Number.isNaN(n) || Number.isNaN(f)) return '—';
  const d = n - f;
  if (d === 0) return '$0';
  return `${d > 0 ? '−' : '+'}$${formatAmount(String(Math.abs(d)))}`;
}

export function TaxYearEditor({
  record,
  feeContext,
  events,
  canEdit,
}: {
  record: TaxYearRecord;
  feeContext: FeeContext;
  events: StageEvent[];
  canEdit: boolean;
}) {
  const org = useOrg();
  const qc = useQueryClient();
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(UpdateTaxYearInput),
    defaultValues: toForm(record),
  });
  useEffect(() => form.reset(toForm(record)), [record, form]);
  const live = useWatch({ control: form.control });
  const [stage, setStage] = useState<ProtestStage>(record.protestStage);
  const [note, setNote] = useState('');
  const { terms } = computeFee(feeContext, { taxYear: record.taxYear });

  const refresh = () => qc.invalidateQueries({ queryKey: ['org', org.orgSlug] });
  const save = useMutation({
    mutationFn: (body: FormOut) =>
      api<TaxYearRecord>(`/orgs/${org.orgSlug}/tax-years/${record.id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      toast.success(`${record.taxYear} values saved.`);
      void refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const changeStage = useMutation({
    mutationFn: () =>
      api<TaxYearRecord>(`/orgs/${org.orgSlug}/tax-years/${record.id}/stage`, {
        method: 'POST',
        body: { stage, note },
      }),
    onSuccess: () => {
      toast.success(`Stage set to ${STAGE_LABELS[stage]}.`);
      setNote('');
      void refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const err = (k: keyof FormIn) =>
    (form.formState.errors[k] as { message?: string } | undefined)?.message;
  const id = (k: string) => `ty-${record.id}-${k}`;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 border-b pb-4">
          <div className="flex items-center gap-3">
            <CardTitle>{record.taxYear} values</CardTitle>
            <StageBadge stage={record.protestStage} />
          </div>
          {canEdit && form.formState.isDirty && (
            <span className="text-sm text-muted-foreground">Unsaved changes</span>
          )}
        </CardHeader>
        <CardContent className="pt-5">
          <form noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))}>
            <fieldset disabled={!canEdit} className="grid gap-8">
              <Section title="Values">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="w-40 pb-2 font-medium" />
                        <th className="pb-2 pr-3 font-medium">Notice</th>
                        <th className="pb-2 pr-3 font-medium">Final</th>
                        <th className="w-32 pb-2 text-right font-medium">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {VALUE_ROWS.map(([label, notice, final]) => (
                        <tr key={label}>
                          <td className="whitespace-nowrap py-1.5 pr-3 text-muted-foreground">
                            {label}
                            {label ===
                              (feeContext.savingsBasis === 'MARKET' ? 'Market' : 'Appraised') && (
                              <span className="ml-1.5 rounded bg-primary/10 px-1 py-0.5 text-[10px] font-medium uppercase text-primary">
                                fee basis
                              </span>
                            )}
                          </td>
                          {([notice, final] as const).map((name) => (
                            <td key={name} className="py-1.5 pr-3">
                              <Controller
                                control={form.control}
                                name={name}
                                render={({ field }) => (
                                  <MoneyInput
                                    {...field}
                                    aria-label={`${label} ${name.startsWith('notice') ? 'notice' : 'final'} value`}
                                    aria-invalid={!!err(name)}
                                  />
                                )}
                              />
                            </td>
                          ))}
                          <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                            {change(live[notice], live[final])}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>

              <Section title="Protest">
                <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
                  <Field label="Notice received" htmlFor={id('nr')} error={err('noticeReceivedAt')}>
                    <Input id={id('nr')} type="date" {...form.register('noticeReceivedAt')} />
                  </Field>
                  <Field label="Protest filed" htmlFor={id('pf')} error={err('protestFiledAt')}>
                    <Input id={id('pf')} type="date" {...form.register('protestFiledAt')} />
                  </Field>
                  <Field label="Result" htmlFor={id('res')}>
                    <NativeSelect
                      id={id('res')}
                      {...form.register('resultType', { setValueAs: (v) => (v === '' ? null : v) })}
                    >
                      <option value="">Pending</option>
                      {RESULT_TYPES.map((r) => (
                        <option key={r} value={r}>
                          {RESULT_LABELS[r]}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Result date" htmlFor={id('rd')} error={err('resultAt')}>
                    <Input id={id('rd')} type="date" {...form.register('resultAt')} />
                  </Field>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  {(
                    [
                      ['homestead', 'Homestead'],
                      ['underArbitration', 'Under arbitration'],
                      ['underLitigation', 'Under litigation'],
                    ] as const
                  ).map(([k, label]) => (
                    <label key={k} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        {...form.register(k)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </Section>

              <Section title="Billing">
                <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
                  <Field label="Combined tax rate" htmlFor={id('rate')} error={err('taxRatePct')}>
                    <div className="relative">
                      <Input
                        id={id('rate')}
                        inputMode="decimal"
                        placeholder="2.15"
                        className="pr-7 text-right tabular-nums"
                        {...form.register('taxRatePct')}
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-muted-foreground">
                        %
                      </span>
                    </div>
                  </Field>
                  <Field
                    label="Contingency for this year"
                    htmlFor={id('ovr')}
                    error={err('contingencyPctOverride')}
                  >
                    <div className="relative">
                      <Input
                        id={id('ovr')}
                        inputMode="decimal"
                        placeholder={`${Number(terms.contingencyPct.value)} (usual)`}
                        className="pr-7 text-right tabular-nums"
                        {...form.register('contingencyPctOverride')}
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-muted-foreground">
                        %
                      </span>
                    </div>
                  </Field>
                  <Field label="BPP rendered" htmlFor={id('bpp')}>
                    <Input id={id('bpp')} type="date" {...form.register('bppRenderedAt')} />
                  </Field>
                  <Field label="BPP fee for this year" htmlFor={id('bppfee')} error={err('bppFee')}>
                    <Controller
                      control={form.control}
                      name="bppFee"
                      render={({ field }) => (
                        <MoneyInput {...field} id={id('bppfee')} placeholder="Usual fee" />
                      )}
                    />
                  </Field>
                </div>
                <p className="text-xs text-muted-foreground">
                  Leave contingency blank to use the usual rate; enter 0 to charge no contingency
                  this year.
                </p>
              </Section>

              <Field label="Notes" htmlFor={id('notes')}>
                <textarea
                  id={id('notes')}
                  rows={2}
                  className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  {...form.register('notes')}
                />
              </Field>

              {canEdit && (
                <div className="flex items-center gap-2 border-t pt-5">
                  <Button type="submit" disabled={!form.formState.isDirty || save.isPending}>
                    {save.isPending && <Loader2 className="animate-spin" />} Save {record.taxYear}{' '}
                    values
                  </Button>
                  {form.formState.isDirty && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => form.reset(toForm(record))}
                    >
                      Discard
                    </Button>
                  )}
                </div>
              )}
            </fieldset>
          </form>
        </CardContent>
      </Card>

      <div className="grid content-start gap-6 xl:sticky xl:top-20 xl:self-start">
        <FeePreview ctx={feeContext} values={{ taxYear: record.taxYear, ...live }} />

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Protest stage</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {canEdit && (
              <div className="grid gap-2">
                <NativeSelect
                  aria-label={`${record.taxYear} stage`}
                  value={stage}
                  onChange={(ev) => setStage(ev.target.value as ProtestStage)}
                >
                  {PROTEST_STAGES.map((s) => (
                    <option key={s} value={s} disabled={SYSTEM_STAGES.includes(s)}>
                      {STAGE_LABELS[s]}
                      {SYSTEM_STAGES.includes(s) ? ' (set by invoicing)' : ''}
                    </option>
                  ))}
                </NativeSelect>
                {stage !== record.protestStage && (
                  <>
                    <Input
                      placeholder="Note (optional)"
                      value={note}
                      onChange={(ev) => setNote(ev.target.value)}
                      aria-label="Stage change note"
                    />
                    <Button
                      size="sm"
                      disabled={changeStage.isPending}
                      onClick={() => changeStage.mutate()}
                    >
                      Move to {STAGE_LABELS[stage]}
                    </Button>
                  </>
                )}
              </div>
            )}
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No stage changes recorded for {record.taxYear}.
              </p>
            ) : (
              <ol className="relative ml-1 space-y-4 border-l pl-4">
                {events.map((e) => (
                  <li key={e.id} className="text-sm">
                    <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-card bg-primary" />
                    <p className="font-medium">{STAGE_LABELS[e.toStage]}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(e.at)}
                      {e.actor && ` · ${e.actor}`}
                    </p>
                    {e.note && (
                      <p className="mt-0.5 text-xs italic text-muted-foreground">{e.note}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
