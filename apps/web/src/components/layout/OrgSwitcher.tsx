import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMe } from '@/hooks/useMe';
import { useOrg } from '@/hooks/useOrg';
import { ROLE_LABELS } from '@/lib/format';
import { initials } from '@/lib/utils';

export function OrgSwitcher() {
  const org = useOrg();
  const { data: me } = useMe();
  const navigate = useNavigate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-sidebar-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground text-xs font-semibold text-background">
          {initials(org.orgName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">
            {org.orgName}
          </span>
          <span className="block text-xs text-muted-foreground">{ROLE_LABELS[org.role]}</span>
        </span>
        <ChevronsUpDown className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Your firms</DropdownMenuLabel>
        {[...(me?.memberships ?? [])]
          .sort((a, b) => a.orgName.localeCompare(b.orgName))
          .map((m) => (
            <DropdownMenuItem key={m.orgId} onSelect={() => navigate(`/${m.orgSlug}`)}>
              <span className="inline-flex size-6 items-center justify-center rounded bg-muted text-[10px] font-semibold">
                {initials(m.orgName)}
              </span>
              <span className="flex-1 truncate">{m.orgName}</span>
              {m.orgSlug === org.orgSlug && <Check className="!text-foreground" />}
            </DropdownMenuItem>
          ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/onboarding')}>
          <Plus /> Create another firm
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
