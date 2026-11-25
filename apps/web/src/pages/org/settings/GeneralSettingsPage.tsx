import { UpdateOrgSettingsInput, type OrgSettings } from '@app/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, NativeSelect } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ME_KEY } from '@/hooks/useMe';
import { useOrg } from '@/hooks/useOrg';
import { orgKey, useOrgQuery } from '@/hooks/useOrgQuery';
import { api } from '@/lib/api';

type FormIn = z.input<typeof UpdateOrgSettingsInput>;
type FormOut = z.output<typeof UpdateOrgSettingsInput>;

const TIMEZONES = [
  ['America/Chicago', 'Central (most of Texas)'],
  ['America/Denver', 'Mountain (El Paso, Hudspeth)'],
  ['America/New_York', 'Eastern'],
  ['America/Los_Angeles', 'Pacific'],
] as const;

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

function Suffix({
  children,
  symbol,
  prefix,
}: {
  children: ReactNode;
  symbol: string;
  prefix?: boolean;
}) {
  return (
    <div className="relative">
      {children}
      <span
        className={`pointer-events-none absolute inset-y-0 flex items-center text-sm text-muted-foreground ${prefix ? 'left-3' : 'right-3'}`}
      >
        {symbol}
      </span>
    </div>
  );
}

function toForm(s: OrgSettings): FormIn {
  return {
    name: s.name,
    timezone: s.timezone,
    phone: s.phone ?? '',
    website: s.website ?? '',
    addressLines: [s.addressLines[0] ?? '', s.addressLines[1] ?? ''],
    primaryColor: s.primaryColor,
    defaultContingencyPct: s.defaultContingencyPct,
    defaultFlatFee: s.defaultFlatFee,
    defaultBppFee: s.defaultBppFee,
    invoicePrefix: s.invoicePrefix,
    nextInvoiceNumber: s.nextInvoiceNumber,
    invoiceDueDays: s.invoiceDueDays,
    taxYearDefault: s.taxYearDefault,
    savingsBasis: s.savingsBasis,
    flatFeeCurrentYearOnly: s.flatFeeCurrentYearOnly,
  };
}

export function GeneralSettingsPage() {
  const org = useOrg();
  const qc = useQueryClient();
  const { data, isPending, error } = useOrgQuery<OrgSettings>('/settings');
  const form = useForm<FormIn, unknown, FormOut>({ resolver: zodResolver(UpdateOrgSettingsInput) });

  const [color, prefix, nextNumber] = useWatch({
    control: form.control,
    name: ['primaryColor', 'invoicePrefix', 'nextInvoiceNumber'],
  });

  useEffect(() => {
    if (data) form.reset(toForm(data));
  }, [data, form]);

  const save = useMutation({
    mutationFn: (body: FormOut) =>
      api<OrgSettings>(`/orgs/${org.orgSlug}/settings`, {
        method: 'PATCH',
        body: { ...body, addressLines: body.addressLines?.filter((l) => l.trim() !== '') },
      }),
    onSuccess: (saved) => {
      qc.setQueryData(orgKey(org.orgSlug, '/settings'), saved);
      void qc.invalidateQueries({ queryKey: ['org', org.orgSlug] });
      void qc.invalidateQueries({ queryKey: ME_KEY });
      form.reset(toForm(saved));
      toast.success('Settings saved.');
    },
    onError: (e) => toast.error(e.message),
  });

  if (error) return <Alert variant="destructive">{error.message}</Alert>;
  if (isPending)
    return (
      <div className="grid gap-6">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-48 w-full" />
        ))}
      </div>
    );

  const e = form.formState.errors;

  return (
    <form
      className="grid gap-6 pb-24"
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      noValidate
    >
      <Section title="Firm profile" description="Shown on invoices, contracts and Form 50-162.">
        <Field label="Firm name" htmlFor="name" error={e.name?.message} className="sm:col-span-2">
          <Input id="name" {...form.register('name')} />
        </Field>
        <Field label="Street address" htmlFor="addr1" error={e.addressLines?.[0]?.message}>
          <Input
            id="addr1"
            placeholder="100 Congress Ave, Suite 400"
            {...form.register('addressLines.0')}
          />
        </Field>
        <Field label="City, state, ZIP" htmlFor="addr2" error={e.addressLines?.[1]?.message}>
          <Input id="addr2" placeholder="Austin, TX 78701" {...form.register('addressLines.1')} />
        </Field>
        <Field label="Phone" htmlFor="phone" error={e.phone?.message}>
          <Input id="phone" type="tel" {...form.register('phone')} />
        </Field>
        <Field label="Website" htmlFor="website" error={e.website?.message}>
          <Input id="website" placeholder="https://" {...form.register('website')} />
        </Field>
        <Field label="Time zone" htmlFor="timezone" hint="Dates and due dates use this time zone.">
          <NativeSelect id="timezone" {...form.register('timezone')}>
            {TIMEZONES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          label="Brand color"
          htmlFor="color"
          error={e.primaryColor?.message}
          hint="Used on invoices and emails. Logo upload comes with file storage."
        >
          <div className="flex gap-2">
            <input
              type="color"
              aria-label="Pick brand color"
              value={color ?? '#1d4ed8'}
              onChange={(ev) =>
                form.setValue('primaryColor', ev.target.value, { shouldDirty: true })
              }
              className="h-9 w-12 cursor-pointer rounded-md border bg-card p-1"
            />
            <Input
              id="color"
              placeholder="#1d4ed8"
              value={color ?? ''}
              onChange={(ev) =>
                form.setValue('primaryColor', ev.target.value === '' ? null : ev.target.value, {
                  shouldDirty: true,
                })
              }
            />
          </div>
        </Field>
      </Section>

      <Section
        title="Fee defaults"
        description="Used when a client or property doesn’t have its own fees."
      >
        <Field
          label="Contingency"
          htmlFor="pct"
          error={e.defaultContingencyPct?.message}
          hint="Share of the client’s tax savings."
        >
          <Suffix symbol="%">
            <Input
              id="pct"
              inputMode="decimal"
              className="pr-8"
              {...form.register('defaultContingencyPct')}
            />
          </Suffix>
        </Field>
        <Field
          label="Flat fee"
          htmlFor="flat"
          error={e.defaultFlatFee?.message}
          hint="Charged per property, on top of contingency."
        >
          <Suffix symbol="$" prefix>
            <Input
              id="flat"
              inputMode="decimal"
              className="pl-7"
              {...form.register('defaultFlatFee')}
            />
          </Suffix>
        </Field>
        <Field
          label="BPP rendition fee"
          htmlFor="bpp"
          error={e.defaultBppFee?.message}
          hint="For business personal property renditions."
        >
          <Suffix symbol="$" prefix>
            <Input
              id="bpp"
              inputMode="decimal"
              className="pl-7"
              {...form.register('defaultBppFee')}
            />
          </Suffix>
        </Field>
      </Section>

      <Section title="Invoicing" description="How invoice numbers and due dates are set.">
        <Field
          label="Number prefix"
          htmlFor="prefix"
          error={e.invoicePrefix?.message}
          hint={`Next invoice: ${prefix ?? ''}${String(nextNumber ?? '')}`}
        >
          <Input id="prefix" {...form.register('invoicePrefix')} />
        </Field>
        <Field label="Next number" htmlFor="next" error={e.nextInvoiceNumber?.message}>
          <Input id="next" inputMode="numeric" {...form.register('nextInvoiceNumber')} />
        </Field>
        <Field label="Payment due after" htmlFor="due" error={e.invoiceDueDays?.message}>
          <Suffix symbol="days">
            <Input
              id="due"
              inputMode="numeric"
              className="pr-12"
              {...form.register('invoiceDueDays')}
            />
          </Suffix>
        </Field>
      </Section>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/90 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-[96rem] items-center justify-end gap-2 px-4 py-3 sm:px-6 lg:px-8">
          {form.formState.isDirty && (
            <p className="mr-auto text-sm text-muted-foreground">You have unsaved changes.</p>
          )}
          <Button
            type="button"
            variant="ghost"
            disabled={!form.formState.isDirty}
            onClick={() => data && form.reset(toForm(data))}
          >
            Discard
          </Button>
          <Button type="submit" disabled={!form.formState.isDirty || save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />} Save changes
          </Button>
        </div>
      </div>
    </form>
  );
}
