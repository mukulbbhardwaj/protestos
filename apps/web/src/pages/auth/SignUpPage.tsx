import { SignUpInput, type Me } from '@app/shared';
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

export function SignUpPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const setMe = useSetMe();
  const next = params.get('next');

  const form = useForm<SignUpInput>({
    resolver: zodResolver(SignUpInput),
    defaultValues: { name: '', email: params.get('email') ?? '', password: '' },
  });
  const signUp = useMutation({
    mutationFn: (body: SignUpInput) => api<Me>('/auth/signup', { method: 'POST', body }),
    onSuccess: (me) => {
      setMe(me);
      navigate(next ?? '/onboarding', { replace: true });
    },
  });
  const { errors } = form.formState;

  return (
    <AuthLayout
      title="Create your account"
      description="Start a 14-day trial. No card needed."
      footer={
        <>
          Already have an account?{' '}
          <Link
            to={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`}
            className="font-medium text-primary hover:underline"
          >
            Log in
          </Link>
        </>
      }
    >
      <form className="grid gap-4" onSubmit={form.handleSubmit((v) => signUp.mutate(v))} noValidate>
        <FormError message={signUp.error?.message} />
        <Field label="Your name" htmlFor="name" error={errors.name?.message}>
          <Input
            id="name"
            autoComplete="name"
            autoFocus
            aria-invalid={!!errors.name}
            {...form.register('name')}
          />
        </Field>
        <Field label="Work email" htmlFor="email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={!!errors.email}
            {...form.register('email')}
          />
        </Field>
        <Field
          label="Password"
          htmlFor="password"
          error={errors.password?.message}
          hint="At least 10 characters."
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            {...form.register('password')}
          />
        </Field>
        <Button type="submit" disabled={signUp.isPending}>
          {signUp.isPending && <Loader2 className="animate-spin" />} Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
