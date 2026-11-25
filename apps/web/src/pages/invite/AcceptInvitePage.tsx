import type { InvitationPreview } from '@app/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Users } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ME_KEY, useMe } from '@/hooks/useMe';
import { api } from '@/lib/api';
import { ROLE_LABELS } from '@/lib/format';
import { AuthLayout, FormError } from '../auth/AuthLayout';

export function AcceptInvitePage() {
  const { token = '' } = useParams();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const preview = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api<InvitationPreview>(`/invitations/${token}`),
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () => api<{ orgSlug: string }>(`/invitations/${token}/accept`, { method: 'POST' }),
    onSuccess: async ({ orgSlug }) => {
      await qc.invalidateQueries({ queryKey: ME_KEY });
      navigate(`/${orgSlug}`, { replace: true });
    },
  });
  const logout = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSuccess: () => qc.setQueryData(ME_KEY, null),
  });

  if (preview.isPending) {
    return (
      <AuthLayout title="Loading invitation…">
        <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
      </AuthLayout>
    );
  }
  if (preview.isError) {
    return (
      <AuthLayout title="Invitation not found">
        <p className="text-sm text-muted-foreground">{preview.error.message}</p>
      </AuthLayout>
    );
  }

  const inv = preview.data;
  const next = encodeURIComponent(`/invite/${token}`);
  const email = encodeURIComponent(inv.email);

  if (inv.status !== 'PENDING') {
    return (
      <AuthLayout title={inv.status === 'ACCEPTED' ? 'Already accepted' : 'Invitation expired'}>
        <p className="text-sm text-muted-foreground">
          {inv.status === 'ACCEPTED'
            ? 'This invitation was already used. Log in to open the firm.'
            : `Ask someone at ${inv.orgName} to send you a new invitation.`}
        </p>
        <Button asChild className="mt-6 w-full">
          <Link to="/">Go to the app</Link>
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={`Join ${inv.orgName}`}>
      <div className="flex gap-3 rounded-lg bg-muted/50 p-3 text-sm">
        <Users className="size-5 shrink-0 text-primary" />
        <p className="text-muted-foreground">
          You’ve been invited as{' '}
          <strong className="text-foreground">{ROLE_LABELS[inv.role]}</strong>. The invitation is
          for <strong className="text-foreground">{inv.email}</strong>.
        </p>
      </div>
      <div className="mt-6 grid gap-2">
        <FormError message={accept.error?.message} />
        {!me ? (
          <>
            <Button asChild>
              <Link to={`/signup?email=${email}&next=${next}`}>Create an account to accept</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={`/login?email=${email}&next=${next}`}>I already have an account</Link>
            </Button>
          </>
        ) : me.user.email.toLowerCase() === inv.email.toLowerCase() ? (
          <Button onClick={() => accept.mutate()} disabled={accept.isPending}>
            {accept.isPending && <Loader2 className="animate-spin" />} Accept and join
          </Button>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              You’re logged in as {me.user.email}. Log out and continue as {inv.email} to accept.
            </p>
            <Button variant="outline" onClick={() => logout.mutate()}>
              Log out
            </Button>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
