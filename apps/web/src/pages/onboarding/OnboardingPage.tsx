import { CreateOrgInput } from '@app/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, MailWarning, RefreshCw } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ME_KEY, useMe } from '@/hooks/useMe';
import { api } from '@/lib/api';
import { AuthLayout, FormError } from '../auth/AuthLayout';
import { DevMailboxHint } from '../auth/ForgotPasswordPage';

export function OnboardingPage() {
  const { data: me, refetch, isFetching } = useMe();
  const resend = useMutation({
    mutationFn: () => api('/auth/resend-verification', { method: 'POST' }),
    onSuccess: () => toast.success('We sent a new confirmation link.'),
    onError: (e) => toast.error(e.message),
  });

  if (!me) return null;

  if (!me.user.emailVerified) {
    return (
      <AuthLayout
        title="Confirm your email"
        description={
          <>
            We sent a link to <strong className="text-foreground">{me.user.email}</strong>. Click it
            to continue setting up your firm.
          </>
        }
      >
        <div className="flex gap-3 rounded-lg border border-warning/30 bg-warning/8 p-3 text-sm">
          <MailWarning className="size-5 shrink-0 text-warning" />
          <p className="text-muted-foreground">
            The link expires in 24 hours. Check your spam folder if you don’t see it.
          </p>
        </div>
        <div className="mt-6 grid gap-2">
          <Button onClick={() => void refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />} I’ve confirmed my
            email
          </Button>
          <Button variant="outline" onClick={() => resend.mutate()} disabled={resend.isPending}>
            Send the link again
          </Button>
        </div>
        {import.meta.env.DEV && <DevMailboxHint />}
      </AuthLayout>
    );
  }

  return <CreateOrgForm />;
}

function CreateOrgForm() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const form = useForm<z.input<typeof CreateOrgInput>, unknown, CreateOrgInput>({
    resolver: zodResolver(CreateOrgInput),
    defaultValues: { name: '', defaultContingencyPct: '30' },
  });
  const create = useMutation({
    mutationFn: (body: CreateOrgInput) => api<{ slug: string }>('/orgs', { method: 'POST', body }),
    onSuccess: async (org) => {
      await qc.invalidateQueries({ queryKey: ME_KEY });
      navigate(`/${org.slug}`, { replace: true });
    },
  });
  const { errors } = form.formState;

  return (
    <AuthLayout
      title="Set up your firm"
      description="You can change all of this later in Settings."
    >
      <form className="grid gap-4" onSubmit={form.handleSubmit((v) => create.mutate(v))} noValidate>
        <FormError message={create.error?.message} />
        <Field label="Firm name" htmlFor="name" error={errors.name?.message}>
          <Input
            id="name"
            autoFocus
            placeholder="Lone Star Property Tax Consultants"
            {...form.register('name')}
          />
        </Field>
        <Field
          label="Default contingency fee"
          htmlFor="pct"
          error={errors.defaultContingencyPct?.message}
          hint="The share of each client’s tax savings you charge, unless a client or property has its own rate."
        >
          <div className="relative">
            <Input
              id="pct"
              inputMode="decimal"
              className="pr-8"
              {...form.register('defaultContingencyPct')}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
              %
            </span>
          </div>
        </Field>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending && <Loader2 className="animate-spin" />} Create firm
        </Button>
      </form>
    </AuthLayout>
  );
}
