import { roleAtLeast, type OrgOverview } from '@app/shared';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Circle,
  Clock,
  FileSignature,
  Home,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/hooks/useMe';
import { useOrg } from '@/hooks/useOrg';
import { useOrgQuery } from '@/hooks/useOrgQuery';
import { daysUntil } from '@/lib/format';
import { cn } from '@/lib/utils';

function StatTile({ label, icon: Icon, note }: { label: string; icon: LucideIcon; note: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{label}</p>
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <p className="mt-2 text-2xl font-semibold tabular-nums text-muted-foreground/60">—</p>
        <p className="mt-1 text-xs text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const org = useOrg();
  const { data: me } = useMe();
  const { data, isPending, error } = useOrgQuery<OrgOverview>('');
  const isAdmin = roleAtLeast(org.role, 'ADMIN');
  const firstName = me?.user.name.split(' ')[0];

  const checklist = data
    ? [
        {
          done: data.checklist.importedData,
          title: 'Import clients and properties',
          body: 'Bring in your spreadsheet in a few minutes.',
          to: 'imports',
          soon: 'M3',
        },
        {
          done: data.checklist.brandingSet,
          title: 'Set up invoice branding',
          body: 'Add your address, phone and brand color.',
          to: 'settings',
          adminOnly: true,
        },
        {
          done: data.checklist.teamInvited,
          title: 'Invite your team',
          body: 'Give consultants and office staff their own logins.',
          to: 'settings/team',
          adminOnly: true,
        },
        {
          done: data.checklist.eSignatureConnected,
          title: 'Connect e-signature',
          body: 'Send contracts and Form 50-162 for signature.',
          to: 'documents',
          soon: 'M6',
        },
      ]
    : [];
  const doneCount = checklist.filter((c) => c.done).length;

  return (
    <>
      <PageHeader
        title={firstName ? `Welcome, ${firstName}` : 'Dashboard'}
        description={`Here’s what’s happening at ${org.orgName}.`}
      />

      {error && (
        <Alert variant="destructive" className="mb-6">
          {error.message}
        </Alert>
      )}

      {data?.plan.status === 'TRIALING' && data.plan.trialEndsAt && (
        <Alert variant="info" className="mb-6">
          <Clock />
          <p>
            <strong>Free trial:</strong> {daysUntil(data.plan.trialEndsAt)} days left.{' '}
            <span className="text-muted-foreground">Plans and billing arrive in M9.</span>
          </p>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Active clients" icon={Users} note="Available once clients exist (M2)" />
        <StatTile
          label="Properties this tax year"
          icon={Home}
          note="Available with properties (M2)"
        />
        <StatTile
          label="Hearings this week"
          icon={CalendarClock}
          note="Available with hearings (M7)"
        />
        <StatTile
          label="Awaiting signature"
          icon={FileSignature}
          note="Available with documents (M6)"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Get your firm set up</CardTitle>
              {data && (
                <Badge variant="secondary">
                  {doneCount} of {checklist.length} done
                </Badge>
              )}
            </div>
            <CardDescription>
              A few steps to go from spreadsheets to sending invoices.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {isPending &&
              Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            {checklist.map((item) => {
              const locked = item.adminOnly && !isAdmin;
              const Icon = item.done ? CheckCircle2 : Circle;
              const inner = (
                <>
                  <Icon
                    className={cn(
                      'mt-0.5 size-5 shrink-0',
                      item.done ? 'text-success' : 'text-muted-foreground/50',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'text-sm font-medium',
                        item.done && 'text-muted-foreground line-through',
                      )}
                    >
                      {item.title}
                      {item.soon && (
                        <Badge variant="outline" className="ml-2 align-middle">
                          {item.soon}
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {locked ? 'An owner or admin can do this.' : item.body}
                    </p>
                  </div>
                  {!locked && (
                    <ArrowRight className="size-4 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                  )}
                </>
              );
              return locked ? (
                <div
                  key={item.title}
                  className="flex items-start gap-3 rounded-lg border p-3 opacity-70"
                >
                  {inner}
                </div>
              ) : (
                <Link
                  key={item.title}
                  to={`/${org.orgSlug}/${item.to}`}
                  className="group flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40"
                >
                  {inner}
                </Link>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your team</CardTitle>
            <CardDescription>People with access to {org.orgName}.</CardDescription>
          </CardHeader>
          <CardContent>
            {isPending ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <dl className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Members</dt>
                  <dd className="text-2xl font-semibold tabular-nums">
                    {data?.counts.members ?? 0}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Pending invites</dt>
                  <dd className="text-2xl font-semibold tabular-nums">
                    {data?.counts.pendingInvitations ?? 0}
                  </dd>
                </div>
              </dl>
            )}
            {isAdmin && (
              <Link
                to={`/${org.orgSlug}/settings/team`}
                className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Manage team <ArrowRight className="size-3.5" />
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
