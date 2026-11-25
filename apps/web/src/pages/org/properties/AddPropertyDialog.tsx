import { CreatePropertyInput, PROPERTY_TYPES, type PropertyDetail } from '@app/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
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
import { useOrg } from '@/hooks/useOrg';
import { useConsultants, useCounties } from '@/hooks/useReference';
import { api } from '@/lib/api';
import { PROPERTY_TYPE_LABELS } from '@/lib/labels';

type FormIn = z.input<typeof CreatePropertyInput>;

export function AddPropertyDialog({
  contactId,
  contactName,
  defaultTaxYear,
  open,
  onOpenChange,
}: {
  contactId: number;
  contactName: string;
  defaultTaxYear: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const org = useOrg();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const counties = useCounties();
  const consultants = useConsultants();
  const form = useForm<FormIn, unknown, CreatePropertyInput>({
    resolver: zodResolver(CreatePropertyInput),
    defaultValues: {
      contactId,
      accountNumber: '',
      countyId: '' as unknown as number,
      propertyType: 'RESIDENTIAL',
      situsAddress: { line1: '', city: '', state: 'TX', zip: '' },
      consultantUserId: null,
      taxYear: defaultTaxYear,
    },
  });
  const create = useMutation({
    mutationFn: (body: CreatePropertyInput) =>
      api<PropertyDetail>(`/orgs/${org.orgSlug}/properties`, { method: 'POST', body }),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['org', org.orgSlug] });
      toast.success(`Property ${p.accountNumber} added.`);
      onOpenChange(false);
      form.reset();
      navigate(`/${org.orgSlug}/properties/${p.id}`);
    },
    onError: (e) => toast.error(e.message),
  });
  const e = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a property</DialogTitle>
          <DialogDescription>
            For {contactName}. An empty {defaultTaxYear} tax-year record is created with it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={form.handleSubmit((v) =>
            create.mutate({ ...v, consultantUserId: v.consultantUserId || null }),
          )}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="County" htmlFor="p-county" error={e.countyId?.message}>
              <NativeSelect id="p-county" {...form.register('countyId')}>
                <option value="">Choose a county…</option>
                {counties.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="CAD account number" htmlFor="p-account" error={e.accountNumber?.message}>
              <Input id="p-account" className="font-mono" {...form.register('accountNumber')} />
            </Field>
          </div>
          <Field label="Property address" htmlFor="p-line1">
            <Input
              id="p-line1"
              placeholder="1234 Main St"
              {...form.register('situsAddress.line1')}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <Field label="City" htmlFor="p-city">
              <Input id="p-city" {...form.register('situsAddress.city')} />
            </Field>
            <Field label="ZIP" htmlFor="p-zip">
              <Input id="p-zip" inputMode="numeric" {...form.register('situsAddress.zip')} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="p-type">
              <NativeSelect id="p-type" {...form.register('propertyType')}>
                {PROPERTY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PROPERTY_TYPE_LABELS[t]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Consultant" htmlFor="p-consultant">
              <NativeSelect id="p-consultant" {...form.register('consultantUserId')}>
                <option value="">Unassigned</option>
                {consultants.data?.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" />} Add property
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
