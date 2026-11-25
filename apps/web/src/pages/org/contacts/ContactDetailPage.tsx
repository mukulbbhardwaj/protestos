import {
  roleAtLeast,
  UpdateContactInput,
  type AuditEntry,
  type ContactDetail,
  type PropertySummary,
} from '@app/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Building2,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Plus,
  User,
  UserCheck,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { z } from 'zod';
import { StageBadge } from '@/components/data/StageBadge';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, NativeSelect } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useOrg } from '@/hooks/useOrg';
import { useOrgQuery } from '@/hooks/useOrgQuery';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { PROPERTY_TYPE_SHORT, PROSPECT_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { AddPropertyDialog } from '../properties/AddPropertyDialog';

type FormIn = z.input<typeof UpdateContactInput>;
type FormOut = z.output<typeof UpdateContactInput>;
type Tab = 'overview' | 'properties' | 'activity';

function toForm(c: ContactDetail): FormIn {
  const addr = c.mailingAddress ?? { line1: '', city: '', state: 'TX', zip: '' };
  return {
    displayName: c.displayName,
    entityType: c.entityType,
    email: c.email ?? '',
    billingEmail: c.billingEmail ?? '',
    phone: c.phone ?? '',
    nameOnCad: c.nameOnCad ?? '',
    mailingAddress: {
      line1: addr.line1,
      line2: addr.line2 ?? '',
      city: addr.city,
      state: addr.state,
      zip: addr.zip,
    },
    contingencyPct: c.contingencyPct ?? '',
    flatFee: c.flatFee ?? '',
    bppFee: c.bppFee ?? '',
    notes: c.notes ?? '',
    ...(c.status ? { status: c.status } : {}),
  };
}

function Info({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground [&_svg]:size-3.5">
      {icon}
      {children}
    </span>
  );
}

export function ContactDetailPage() {
  const { contactId = '' } = useParams();
  const org = useOrg();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const [adding, setAdding] = useState(false);
  const canEdit = roleAtLeast(org.role, 'STAFF');
  const isAdmin = roleAtLeast(org.role, 'ADMIN');

  const { data: c, error, isPending } = useOrgQuery<ContactDetail>(`/contacts/${contactId}`);
  const props = useOrgQuery<{ items: PropertySummary[]; total: number }>(
    `/properties?contactId=${contactId}&archived=all&pageSize=200&sort=account`,
  );
  const overview = useOrgQuery<{ stats: { taxYear: number } }>('');

  const action = useMutation({
    mutationFn: (path: 'convert' | 'archive' | 'restore') =>
      api<ContactDetail>(`/orgs/${org.orgSlug}/contacts/${contactId}/${path}`, { method: 'POST' }),
    onSuccess: (_d, path) => {
      void qc.invalidateQueries({ queryKey: ['org', org.orgSlug] });
      toast.success(
        {
          convert: 'Converted to a client.',
          archive: 'Archived, with their properties.',
          restore: 'Restored.',
        }[path],
      );
    },
    onError: (e) => toast.error(e.message),
  });

  if (error) return <Alert variant="destructive">{error.message}</Alert>;
  if (isPending || !c) return <Skeleton className="h-64 w-full" />;

  const isClient = c.kind === 'CLIENT';
  const backTo = isClient ? 'clients' : 'prospects';
  const addr = c.mailingAddress;

  return (
    <>
      <Link
        to={`/${org.orgSlug}/${backTo}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> {isClient ? 'Clients' : 'Prospects'}
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {c.entityType === 'COMPANY' ? (
              <Building2 className="size-5" />
            ) : (
              <User className="size-5" />
            )}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{c.displayName}</h1>
              {isClient ? (
                <Badge variant="secondary" className="font-mono">
                  #{c.clientNumber}
                </Badge>
              ) : (
                c.status && <Badge>{PROSPECT_LABELS[c.status]}</Badge>
              )}
              {c.archivedAt && <Badge variant="outline">Archived {formatDate(c.archivedAt)}</Badge>}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
              {c.email && (
                <Info icon={<Mail />}>
                  <a href={`mailto:${c.email}`} className="hover:underline">
                    {c.email}
                  </a>
                </Info>
              )}
              {c.phone && <Info icon={<Phone />}>{c.phone}</Info>}
              {addr?.city && (
                <Info icon={<MapPin />}>{[addr.line1, addr.city].filter(Boolean).join(', ')}</Info>
              )}
              {isClient && c.convertedAt && (
                <Info icon={<UserCheck />}>Client since {formatDate(c.convertedAt)}</Info>
              )}
            </div>
          </div>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            {!isClient && !c.archivedAt && (
              <Button onClick={() => action.mutate('convert')} disabled={action.isPending}>
                <UserCheck /> Convert to client
              </Button>
            )}
            {c.archivedAt ? (
              <Button
                variant="outline"
                onClick={() => action.mutate('restore')}
                disabled={action.isPending}
              >
                <ArchiveRestore /> Restore
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={action.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      `Archive ${c.displayName} and their ${c.propertyCount} active properties? You can restore them later.`,
                    )
                  ) {
                    action.mutate('archive');
                  }
                }}
              >
                <Archive /> Archive
              </Button>
            )}
          </div>
        )}
      </div>

      <nav aria-label="Client sections" className="mb-6 flex gap-1 border-b">
        {(
          [
            ['overview', 'Overview'],
            ['properties', `Properties (${props.data?.total ?? c.propertyCount})`],
            ...(isAdmin ? ([['activity', 'Activity']] as const) : []),
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              '-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground',
              tab === key && 'border-primary text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && <OverviewTab contact={c} canEdit={canEdit && !c.archivedAt} />}

      {tab === 'properties' && (
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Properties</CardTitle>
              <CardDescription>
                Stages and values for {overview.data?.stats.taxYear ?? 'the current year'}.
              </CardDescription>
            </div>
            {canEdit && !c.archivedAt && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus /> Add property
              </Button>
            )}
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Account</TableHead>
                <TableHead>County</TableHead>
                <TableHead className="hidden md:table-cell">Address</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Notice → final</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.data?.items.map((p) => (
                <TableRow
                  key={p.id}
                  className={cn('cursor-pointer', p.archivedAt && 'opacity-60')}
                  onClick={() => navigate(`/${org.orgSlug}/properties/${p.id}`)}
                >
                  <TableCell className="font-mono text-xs">{p.accountNumber}</TableCell>
                  <TableCell>{p.county.name}</TableCell>
                  <TableCell className="hidden max-w-64 truncate text-muted-foreground md:table-cell">
                    {p.situsLine}
                  </TableCell>
                  <TableCell>{PROPERTY_TYPE_SHORT[p.propertyType]}</TableCell>
                  <TableCell>
                    {p.year ? (
                      <StageBadge stage={p.year.protestStage} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                    {p.year?.noticeAppraised
                      ? formatMoney(p.year.noticeAppraised).replace('.00', '')
                      : '—'}
                    {p.year?.finalAppraised && (
                      <>
                        {' '}
                        →{' '}
                        <span className="text-foreground">
                          {formatMoney(p.year.finalAppraised).replace('.00', '')}
                        </span>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {props.data?.items.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No properties yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {tab === 'activity' && <ActivityTab contactId={c.id} />}

      <AddPropertyDialog
        contactId={c.id}
        contactName={c.displayName}
        defaultTaxYear={overview.data?.stats.taxYear ?? new Date().getFullYear()}
        open={adding}
        onOpenChange={setAdding}
      />
    </>
  );
}

function OverviewTab({ contact: c, canEdit }: { contact: ContactDetail; canEdit: boolean }) {
  const org = useOrg();
  const qc = useQueryClient();
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(UpdateContactInput),
    defaultValues: toForm(c),
  });
  useEffect(() => form.reset(toForm(c)), [c, form]);
  const save = useMutation({
    mutationFn: (body: FormOut) =>
      api<ContactDetail>(`/orgs/${org.orgSlug}/contacts/${c.id}`, { method: 'PATCH', body }),
    onSuccess: (saved) => {
      qc.setQueryData(['org', org.orgSlug, `/contacts/${c.id}`], saved);
      void qc.invalidateQueries({ queryKey: ['org', org.orgSlug, 'contacts'] });
      toast.success('Saved.');
    },
    onError: (e) => toast.error(e.message),
  });
  const e = form.formState.errors;

  return (
    <form
      className="grid gap-6 lg:grid-cols-3"
      noValidate
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
    >
      <fieldset disabled={!canEdit} className="contents">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Contact details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="d-name" error={e.displayName?.message}>
              <Input id="d-name" {...form.register('displayName')} />
            </Field>
            <Field
              label="Name on CAD records"
              htmlFor="d-cad"
              hint="As the appraisal district lists the owner."
            >
              <Input id="d-cad" {...form.register('nameOnCad')} />
            </Field>
            <Field label="Email" htmlFor="d-email" error={e.email?.message}>
              <Input id="d-email" type="email" {...form.register('email')} />
            </Field>
            <Field
              label="Billing email"
              htmlFor="d-billing"
              error={e.billingEmail?.message}
              hint="Invoices go here when set."
            >
              <Input id="d-billing" type="email" {...form.register('billingEmail')} />
            </Field>
            <Field label="Phone" htmlFor="d-phone">
              <Input id="d-phone" type="tel" {...form.register('phone')} />
            </Field>
            <Field label="Type" htmlFor="d-type">
              <NativeSelect id="d-type" {...form.register('entityType')}>
                <option value="INDIVIDUAL">Individual</option>
                <option value="COMPANY">Company</option>
              </NativeSelect>
            </Field>
            <Field label="Mailing address" htmlFor="d-line1" className="sm:col-span-2">
              <Input id="d-line1" {...form.register('mailingAddress.line1')} />
            </Field>
            <div className="grid gap-4 sm:col-span-2 sm:grid-cols-[1fr_5rem_8rem]">
              <Field label="City" htmlFor="d-city">
                <Input id="d-city" {...form.register('mailingAddress.city')} />
              </Field>
              <Field label="State" htmlFor="d-state">
                <Input id="d-state" {...form.register('mailingAddress.state')} />
              </Field>
              <Field label="ZIP" htmlFor="d-zip">
                <Input id="d-zip" {...form.register('mailingAddress.zip')} />
              </Field>
            </div>
            <Field label="Notes" htmlFor="d-notes" className="sm:col-span-2">
              <textarea
                id="d-notes"
                rows={3}
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                {...form.register('notes')}
              />
            </Field>
          </CardContent>
        </Card>
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Fee terms</CardTitle>
              <CardDescription>
                Leave blank to use the firm’s defaults. A property can override these.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Contingency %" htmlFor="d-pct" error={e.contingencyPct?.message}>
                <Input
                  id="d-pct"
                  inputMode="decimal"
                  placeholder="Firm default"
                  {...form.register('contingencyPct')}
                />
              </Field>
              <Field label="Flat fee ($)" htmlFor="d-flat" error={e.flatFee?.message}>
                <Input
                  id="d-flat"
                  inputMode="decimal"
                  placeholder="Firm default"
                  {...form.register('flatFee')}
                />
              </Field>
              <Field label="BPP rendition fee ($)" htmlFor="d-bpp" error={e.bppFee?.message}>
                <Input
                  id="d-bpp"
                  inputMode="decimal"
                  placeholder="Firm default"
                  {...form.register('bppFee')}
                />
              </Field>
            </CardContent>
          </Card>
          {canEdit && (
            <Button type="submit" disabled={!form.formState.isDirty || save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />} Save changes
            </Button>
          )}
        </div>
      </fieldset>
    </form>
  );
}

function ActivityTab({ contactId }: { contactId: number }) {
  const { data, isPending } = useOrgQuery<{ entries: AuditEntry[] }>(
    `/audit-log?entityType=Contact&entityId=${contactId}`,
  );
  if (isPending) return <Skeleton className="h-32 w-full" />;
  return (
    <Card>
      <CardContent className="p-0">
        {data?.entries.length ? (
          <ul className="divide-y">
            {data.entries.map((e) => (
              <li key={e.id} className="flex justify-between gap-4 px-5 py-3 text-sm">
                <span>
                  <span className="font-medium">{e.actor ?? 'System'}</span>{' '}
                  <span className="text-muted-foreground">{e.action.replace('contact.', '')}</span>
                </span>
                <span className="text-muted-foreground">{formatDateTime(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            No recorded changes yet. Edits, conversions and archiving show up here.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
