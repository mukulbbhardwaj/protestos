import {
  CreateInvitationInput,
  ORG_ROLES,
  type Invitation,
  type Member,
  type OrgRole,
} from '@app/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  MailPlus,
  MoreHorizontal,
  RotateCw,
  UserCheck,
  UserX,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field } from '@/components/ui/field';
import { Input, NativeSelect } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useMe } from '@/hooks/useMe';
import { useOrg } from '@/hooks/useOrg';
import { useOrgQuery } from '@/hooks/useOrgQuery';
import { api } from '@/lib/api';
import { formatDate, ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/format';

function useOrgMutation<TVars>(fn: (vars: TVars) => Promise<unknown>, success: string) {
  const { orgSlug } = useOrg();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(success);
      void qc.invalidateQueries({ queryKey: ['org', orgSlug] });
    },
    onError: (e) => toast.error(e.message),
  });
}

function assignableRoles(myRole: OrgRole): OrgRole[] {
  return myRole === 'OWNER' ? [...ORG_ROLES] : ORG_ROLES.filter((r) => r !== 'OWNER');
}

function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const org = useOrg();
  const form = useForm<CreateInvitationInput>({
    resolver: zodResolver(CreateInvitationInput),
    defaultValues: { email: '', role: 'STAFF' },
  });
  const invite = useOrgMutation(
    (body: CreateInvitationInput) =>
      api(`/orgs/${org.orgSlug}/invitations`, { method: 'POST', body }),
    'Invitation sent.',
  );
  const role = useWatch({ control: form.control, name: 'role' });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) form.reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
          <DialogDescription>
            They’ll get an email with a link to join {org.orgName}. The link works for 7 days.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={form.handleSubmit((v) =>
            invite.mutate(v, {
              onSuccess: () => {
                onOpenChange(false);
                form.reset();
              },
            }),
          )}
        >
          <Field label="Email" htmlFor="invite-email" error={form.formState.errors.email?.message}>
            <Input
              id="invite-email"
              type="email"
              autoFocus
              placeholder="name@yourfirm.com"
              {...form.register('email')}
            />
          </Field>
          <Field label="Role" htmlFor="invite-role" hint={ROLE_DESCRIPTIONS[role]}>
            <NativeSelect id="invite-role" {...form.register('role')}>
              {assignableRoles(org.role).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={invite.isPending}>
              {invite.isPending && <Loader2 className="animate-spin" />} Send invitation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MemberRow({ member }: { member: Member }) {
  const org = useOrg();
  const { data: me } = useMe();
  const isMe = me?.user.id === member.userId;
  const canManage = !isMe && (org.role === 'OWNER' || member.role !== 'OWNER');
  const update = useOrgMutation(
    (body: Partial<Pick<Member, 'role' | 'status'>>) =>
      api(`/orgs/${org.orgSlug}/members/${member.id}`, { method: 'PATCH', body }),
    'Team member updated.',
  );
  const disabled = member.status === 'DISABLED';

  return (
    <TableRow className={disabled ? 'opacity-60' : undefined}>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar name={member.name} />
          <div className="min-w-0">
            <p className="truncate font-medium">
              {member.name}{' '}
              {isMe && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
            </p>
            <p className="truncate text-xs text-muted-foreground">{member.email}</p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        {canManage && !disabled ? (
          <NativeSelect
            aria-label={`Role for ${member.name}`}
            className="h-8 w-32"
            value={member.role}
            disabled={update.isPending}
            onChange={(e) => update.mutate({ role: e.target.value as OrgRole })}
          >
            {assignableRoles(org.role).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <span className="text-sm">{ROLE_LABELS[member.role]}</span>
        )}
      </TableCell>
      <TableCell>
        {disabled ? (
          <Badge variant="outline">Disabled</Badge>
        ) : (
          <Badge variant="success">Active</Badge>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">{formatDate(member.joinedAt)}</TableCell>
      <TableCell className="w-12 text-right">
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for ${member.name}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {disabled ? (
                <DropdownMenuItem onSelect={() => update.mutate({ status: 'ACTIVE' })}>
                  <UserCheck /> Restore access
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  destructive
                  onSelect={() => update.mutate({ status: 'DISABLED' })}
                >
                  <UserX /> Remove access
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  );
}

function InvitationRow({ inv }: { inv: Invitation }) {
  const org = useOrg();
  const resend = useOrgMutation(
    () => api(`/orgs/${org.orgSlug}/invitations/${inv.id}/resend`, { method: 'POST' }),
    'Invitation sent again.',
  );
  const revoke = useOrgMutation(
    () => api(`/orgs/${org.orgSlug}/invitations/${inv.id}`, { method: 'DELETE' }),
    'Invitation revoked.',
  );
  const variant = {
    PENDING: 'warning',
    ACCEPTED: 'success',
    REVOKED: 'outline',
    EXPIRED: 'outline',
  } as const;
  return (
    <TableRow>
      <TableCell className="font-medium">{inv.email}</TableCell>
      <TableCell>{ROLE_LABELS[inv.role]}</TableCell>
      <TableCell>
        <Badge variant={variant[inv.status]}>
          {inv.status.charAt(0) + inv.status.slice(1).toLowerCase()}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {inv.status === 'PENDING'
          ? `Expires ${formatDate(inv.expiresAt)}`
          : `Sent ${formatDate(inv.createdAt)}`}
        {inv.invitedBy && <span className="block text-xs">by {inv.invitedBy}</span>}
      </TableCell>
      <TableCell className="text-right">
        {(inv.status === 'PENDING' || inv.status === 'EXPIRED') && (
          <div className="flex justify-end gap-1">
            {inv.status === 'PENDING' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => resend.mutate(undefined)}
                disabled={resend.isPending}
              >
                <RotateCw /> Resend
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => revoke.mutate(undefined)}
              disabled={revoke.isPending}
            >
              <XCircle /> Revoke
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

export function TeamSettingsPage() {
  const [inviteOpen, setInviteOpen] = useState(false);
  const members = useOrgQuery<{ members: Member[] }>('/members');
  const invitations = useOrgQuery<{ invitations: Invitation[] }>('/invitations');
  const visibleInvites = invitations.data?.invitations.filter((i) => i.status !== 'ACCEPTED') ?? [];

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Team members</CardTitle>
            <CardDescription>Owners and admins can change roles and remove access.</CardDescription>
          </div>
          <Button onClick={() => setInviteOpen(true)}>
            <MailPlus /> Invite
          </Button>
        </CardHeader>
        <CardContent className="px-0">
          {members.error && (
            <Alert variant="destructive" className="mx-5">
              {members.error.message}
            </Alert>
          )}
          {members.isPending ? (
            <div className="space-y-2 px-5">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.data?.members.map((m) => (
                  <MemberRow key={m.id} member={m} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invitations</CardTitle>
          <CardDescription>Pending, revoked and expired invitations.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {invitations.isPending ? (
            <div className="px-5">
              <Skeleton className="h-12 w-full" />
            </div>
          ) : visibleInvites.length === 0 ? (
            <p className="px-5 pb-2 text-sm text-muted-foreground">
              No open invitations. Use “Invite” to add someone.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleInvites.map((i) => (
                  <InvitationRow key={i.id} inv={i} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}
