import { roleAtLeast, type OrgRole } from '@app/shared';
import { Loader2, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useMe } from '@/hooks/useMe';
import { lastOrg, OrgContext, rememberOrg, useOrg } from '@/hooks/useOrg';
import { AppShell } from './AppShell';

export function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
    </div>
  );
}

/** Logged-in users only; others go to /login and come back afterwards. */
export function RequireAuth() {
  const { data: me, isPending } = useMe();
  const location = useLocation();
  if (isPending) return <FullPageSpinner />;
  if (!me) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <Outlet />;
}

/** Logged-out pages (login, sign-up) bounce logged-in users into the app. */
export function GuestOnly() {
  const { data: me, isPending } = useMe();
  const location = useLocation();
  if (isPending) return <FullPageSpinner />;
  if (me) {
    const next = new URLSearchParams(location.search).get('next');
    return <Navigate to={next ?? '/'} replace />;
  }
  return <Outlet />;
}

/** `/`: send people to the right place. */
export function HomeRedirect() {
  const { data: me } = useMe();
  if (!me) return null;
  if (me.memberships.length === 0) return <Navigate to="/onboarding" replace />;
  const remembered = me.memberships.find((m) => m.orgSlug === lastOrg());
  return <Navigate to={`/${(remembered ?? me.memberships[0]!).orgSlug}`} replace />;
}

/** `/:orgSlug/*`: checks membership, provides the org, renders the shell. */
export function OrgLayout() {
  const { orgSlug } = useParams();
  const { data: me } = useMe();
  const membership = me?.memberships.find((m) => m.orgSlug === orgSlug);
  if (!membership)
    return <NotFoundPage message="We couldn’t find that firm, or you’re not a member of it." />;
  rememberOrg(membership.orgSlug);
  return (
    <OrgContext.Provider value={membership}>
      <AppShell>
        <Outlet />
      </AppShell>
    </OrgContext.Provider>
  );
}

/** Hides a page from roles below `minimum` (the API enforces the same rule). */
export function RequireRole({ minimum, children }: { minimum: OrgRole; children: ReactNode }) {
  const org = useOrg();
  if (roleAtLeast(org.role, minimum)) return <>{children}</>;
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
        <Lock className="size-5 text-muted-foreground" />
      </span>
      <h1 className="text-lg font-semibold">You don’t have access to this page</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Ask an owner or admin of {org.orgName} if you need it.
      </p>
      <Button asChild variant="outline" className="mt-6">
        <Link to={`/${org.orgSlug}`}>Back to dashboard</Link>
      </Button>
    </div>
  );
}

export function NotFoundPage({ message }: { message?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-medium text-primary">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        {message ?? 'The page you’re looking for doesn’t exist or has moved.'}
      </p>
      <Button asChild className="mt-6">
        <Link to="/">Go home</Link>
      </Button>
    </div>
  );
}
