import { roleAtLeast } from '@app/shared';
import { Menu, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useOrg } from '@/hooks/useOrg';
import { cn } from '@/lib/utils';
import { MODULES, type ModuleDef } from '@/modules';
import { Logo } from './Logo';
import { OrgSwitcher } from './OrgSwitcher';
import { SearchButton } from './SearchDialog';
import { UserMenu } from './UserMenu';

const GROUPS: ModuleDef['group'][] = ['Work', 'Money', 'Firm'];

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const org = useOrg();
  const visible = MODULES.filter((m) => roleAtLeast(org.role, m.minRole));

  return (
    <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
      {GROUPS.map((group) => {
        const items = visible.filter((m) => m.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group}>
            <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
              {group}
            </p>
            <ul className="space-y-0.5">
              {items.map((m) => (
                <li key={m.key}>
                  <NavLink
                    to={`/${org.orgSlug}${m.path ? `/${m.path}` : ''}`}
                    end={m.path === ''}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
                        isActive && 'bg-sidebar-accent font-medium text-foreground',
                      )
                    }
                  >
                    <m.icon className="size-4 shrink-0 opacity-80" />
                    <span className="flex-1">{m.label}</span>
                    {m.comingIn && (
                      <span className="rounded px-1 text-[10px] font-medium text-muted-foreground/70">
                        {m.comingIn}
                      </span>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <OrgSwitcher />
      </div>
      <SidebarNav {...(onNavigate ? { onNavigate } : {})} />
      <div className="border-t p-3">
        <UserMenu />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  // The drawer closes itself when a nav link is clicked (SidebarBody onNavigate).
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r bg-sidebar lg:block">
        <SidebarBody />
      </aside>

      {/* Tablet / phone drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r bg-sidebar shadow-xl">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-3"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            >
              <X />
            </Button>
            <SidebarBody onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu />
          </Button>
          <Logo withName={false} className="lg:hidden" />
          <SearchButton />
        </header>
        <main className="mx-auto w-full max-w-[96rem] px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
