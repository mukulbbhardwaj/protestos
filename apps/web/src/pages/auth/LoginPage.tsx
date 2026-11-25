import { LoginInput, type Me } from '@app/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useSetMe } from '@/hooks/useMe';
import { api } from '@/lib/api';
import { AuthLayout, FormError } from './AuthLayout';

const DEMO_ACCOUNTS = [
  ['owner@demo.test', 'Owner (and admin of a 2nd firm)'],
  ['admin@demo.test', 'Admin'],
  ['staff@demo.test', 'Staff'],
  ['viewer@demo.test', 'Read only'],
] as const;

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const setMe = useSetMe();
  const next = params.get('next') ?? '/';

  const form = useForm<LoginInput>({
    resolver: zodResolver(LoginInput),
    defaultValues: { email: params.get('email') ?? '', password: '' },
  });
  const login = useMutation({
    mutationFn: (body: LoginInput) => api<Me>('/auth/login', { method: 'POST', body }),
    onSuccess: (me) => {
      setMe(me);
      navigate(next, { replace: true });
    },
  });
  const { errors } = form.formState;

  return (
    <AuthLayout
      title="Log in"
      description="Welcome back. Log in to your firm’s workspace."
      footer={
        <>
          New here?{' '}
          <Link
            to={`/signup${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`}
            className="font-medium text-primary hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form className="grid gap-4" onSubmit={form.handleSubmit((v) => login.mutate(v))} noValidate>
        <FormError message={login.error?.message} />
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            aria-invalid={!!errors.email}
            {...form.register('email')}
          />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            {...form.register('password')}
          />
        </Field>
        <div className="-mt-1 text-right">
          <Link to="/forgot-password" className="text-xs font-medium text-primary hover:underline">
            Forgot your password?
          </Link>
        </div>
        <Button type="submit" disabled={login.isPending}>
          {login.isPending && <Loader2 className="animate-spin" />} Log in
        </Button>
      </form>

      {import.meta.env.DEV && (
        <div className="mt-6 rounded-lg border border-dashed bg-muted/40 p-3 text-xs">
          <p className="font-medium text-foreground">Demo accounts (local only)</p>
          <p className="mt-0.5 text-muted-foreground">
            Password <code className="rounded bg-muted px-1">demo-password</code>
          </p>
          <ul className="mt-2 space-y-1">
            {DEMO_ACCOUNTS.map(([email, label]) => (
              <li key={email}>
                <button
                  type="button"
                  className="w-full rounded px-1.5 py-1 text-left hover:bg-accent"
                  onClick={() => {
                    form.setValue('email', email);
                    form.setValue('password', 'demo-password');
                  }}
                >
                  <span className="font-mono text-foreground">{email}</span>
                  <span className="text-muted-foreground"> · {label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </AuthLayout>
  );
}
