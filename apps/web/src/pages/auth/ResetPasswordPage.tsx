import { Password } from '@app/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { AuthLayout, FormError } from './AuthLayout';

const Form = z
  .object({ password: Password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'Passwords don’t match.',
  });
type Form = z.infer<typeof Form>;

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const form = useForm<Form>({
    resolver: zodResolver(Form),
    defaultValues: { password: '', confirm: '' },
  });
  const reset = useMutation({
    mutationFn: (v: Form) =>
      api('/auth/reset-password', { method: 'POST', body: { token, password: v.password } }),
    onSuccess: () => {
      toast.success('Password changed. Log in with your new password.');
      navigate('/login', { replace: true });
    },
  });
  const { errors } = form.formState;

  return (
    <AuthLayout
      title="Choose a new password"
      description="You’ll be logged out of every other device."
      footer={
        <Link to="/login" className="font-medium text-primary hover:underline">
          Back to log in
        </Link>
      }
    >
      <form className="grid gap-4" onSubmit={form.handleSubmit((v) => reset.mutate(v))} noValidate>
        <FormError
          message={
            !token ? 'This link is missing its token. Request a new one.' : reset.error?.message
          }
        />
        <Field
          label="New password"
          htmlFor="password"
          error={errors.password?.message}
          hint="At least 10 characters."
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            autoFocus
            {...form.register('password')}
          />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={errors.confirm?.message}>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            {...form.register('confirm')}
          />
        </Field>
        <Button type="submit" disabled={reset.isPending || !token}>
          {reset.isPending && <Loader2 className="animate-spin" />} Change password
        </Button>
      </form>
    </AuthLayout>
  );
}
