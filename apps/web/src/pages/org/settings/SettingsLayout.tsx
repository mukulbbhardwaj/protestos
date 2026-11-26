import { NavLink, Outlet } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { RequireRole } from '@/components/layout/guards';
import { useOrg } from '@/hooks/useOrg';
import { cn } from '@/lib/utils';

const TABS = [
  { to: '', label: 'General' },
  { to: 'team', label: 'Team' },
  { to: 'emails', label: 'Emails' },
  { to: 'documents', label: 'Documents' },
  { to: 'audit-log', label: 'Audit log' },
];

export function SettingsLayout() {
  const org = useOrg();
  return (
    <RequireRole minimum="ADMIN">
      <PageHeader
        title="Settings"
        description="Your firm’s profile, fee defaults, invoicing and team."
      />
      <nav aria-label="Settings" className="mb-6 flex gap-1 border-b">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={`/${org.orgSlug}/settings${t.to ? `/${t.to}` : ''}`}
            end
            className={({ isActive }) =>
              cn(
                '-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground',
                isActive && 'border-primary text-foreground',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </RequireRole>
  );
}
