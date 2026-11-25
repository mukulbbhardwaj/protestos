import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ME_KEY } from '@/hooks/useMe';
import { api } from '@/lib/api';
import { AuthLayout } from './AuthLayout';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const qc = useQueryClient();
  const verify = useMutation({
    mutationFn: () => api('/auth/verify-email', { method: 'POST', body: { token } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  });
  const started = useRef(false);
  useEffect(() => {
    // StrictMode mounts twice in dev; the token is single-use.
    if (started.current || !token) return;
    started.current = true;
    verify.mutate();
  }, [token, verify]);

  if (verify.isSuccess) {
    return (
      <AuthLayout title="Email confirmed">
        <div className="flex gap-3 text-sm text-muted-foreground">
          <CheckCircle2 className="size-5 shrink-0 text-success" />
          <p>Thanks. Your email address is confirmed and you can set up your firm.</p>
        </div>
        <Button asChild className="mt-6 w-full">
          <Link to="/">Continue</Link>
        </Button>
      </AuthLayout>
    );
  }
  if (verify.isError || !token) {
    return (
      <AuthLayout title="That link didn’t work">
        <div className="flex gap-3 text-sm text-muted-foreground">
          <XCircle className="size-5 shrink-0 text-destructive" />
          <p>
            {verify.error?.message ?? 'This link is missing its token.'} You can send a new link
            after you log in.
          </p>
        </div>
        <Button asChild variant="outline" className="mt-6 w-full">
          <Link to="/">Continue</Link>
        </Button>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Confirming your email…">
      <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
    </AuthLayout>
  );
}
