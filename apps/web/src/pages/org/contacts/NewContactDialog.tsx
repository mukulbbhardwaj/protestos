import { CreateContactInput, type ContactDetail } from '@app/shared';
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
import { api } from '@/lib/api';

type FormIn = z.input<typeof CreateContactInput>;

export function NewContactDialog({
  kind,
  open,
  onOpenChange,
}: {
  kind: 'CLIENT' | 'PROSPECT';
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const org = useOrg();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const form = useForm<FormIn, unknown, CreateContactInput>({
    resolver: zodResolver(CreateContactInput),
    defaultValues: {
      kind,
      entityType: 'INDIVIDUAL',
      displayName: '',
      email: '',
      phone: '',
      source: 'MANUAL',
    },
  });
  const create = useMutation({
    mutationFn: (body: CreateContactInput) =>
      api<ContactDetail>(`/orgs/${org.orgSlug}/contacts`, { method: 'POST', body }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['org', org.orgSlug] });
      toast.success(kind === 'CLIENT' ? `Client ${c.clientNumber} created.` : 'Prospect added.');
      onOpenChange(false);
      form.reset();
      navigate(`/${org.orgSlug}/contacts/${c.id}`);
    },
    onError: (e) => toast.error(e.message),
  });
  const e = form.formState.errors;
  const noun = kind === 'CLIENT' ? 'client' : 'prospect';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New {noun}</DialogTitle>
          <DialogDescription>
            {kind === 'CLIENT'
              ? 'A client number is assigned automatically.'
              : 'You can convert a prospect to a client once they sign.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={form.handleSubmit((v) => create.mutate(v))}
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <Field label="Name" htmlFor="c-name" error={e.displayName?.message}>
              <Input
                id="c-name"
                autoFocus
                placeholder="Jane Smith or Smith Holdings LLC"
                {...form.register('displayName')}
              />
            </Field>
            <Field label="Type" htmlFor="c-type">
              <NativeSelect id="c-type" {...form.register('entityType')}>
                <option value="INDIVIDUAL">Individual</option>
                <option value="COMPANY">Company</option>
              </NativeSelect>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" htmlFor="c-email" error={e.email?.message}>
              <Input id="c-email" type="email" {...form.register('email')} />
            </Field>
            <Field label="Phone" htmlFor="c-phone" error={e.phone?.message}>
              <Input id="c-phone" type="tel" {...form.register('phone')} />
            </Field>
          </div>
          <Field label="Source" htmlFor="c-source">
            <NativeSelect id="c-source" {...form.register('source')}>
              <option value="MANUAL">Entered by hand</option>
              <option value="REFERRAL">Referral</option>
              <option value="WEB_FORM">Website form</option>
            </NativeSelect>
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" />} Create {noun}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
