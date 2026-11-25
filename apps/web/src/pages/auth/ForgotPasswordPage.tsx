import { ForgotPasswordInput } from '@app/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Loader2, MailCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { AuthLayout, FormError } from './AuthLayout';

export function ForgotPasswordPage() {
  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(ForgotPasswordInput),
    defaultValues: { email: '' },
  });
  const request = useMutation({
    mutationFn: (body: ForgotPasswordInput) =>
      api('/auth/forgot-password', { method: 'POST', body }),
  });

  if (request.isSuccess) {
    return (
      <AuthLayout
        title="Check your email"
        footer={
          <Link to="/login" className="font-medium text-primary hover:underline">
            Back to log in
          </Link>
        }
      >
        <div className="flex gap-3 text-sm text-muted-foreground">
          <MailCheck className="size-5 shrink-0 text-primary" />
          <p>
            If an account exists for{' '}
            <strong className="text-foreground">{form.getValues('email')}</strong>, we sent a link
            to choose a new password. It expires in 1 hour.
          </p>
        </div>
        {import.meta.env.DEV && <DevMailboxHint />}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="Enter your email and we’ll send you a link to choose a new password."
      footer={
        <Link to="/login" className="font-medium text-primary hover:underline">
          Back to log in
        </Link>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={form.handleSubmit((v) => request.mutate(v))}
        noValidate
      >
        <FormError message={request.error?.message} />
        <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            {...form.register('email')}
          />
        </Field>
        <Button type="submit" disabled={request.isPending}>
          {request.isPending && <Loader2 className="animate-spin" />} Send reset link
        </Button>
      </form>
    </AuthLayout>
  );
}

export function DevMailboxHint() {
  return (
    <p className="mt-4 rounded-md border border-dashed bg-muted/40 p-2.5 text-xs text-muted-foreground">
      Local development: emails aren’t really sent. Open the{' '}
      <Link to="/dev/mailbox" className="font-medium text-primary hover:underline">
        dev mailbox
      </Link>{' '}
      to see them.
    </p>
  );
}
