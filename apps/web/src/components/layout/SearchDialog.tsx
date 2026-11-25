import type { SearchResults } from '@app/shared';
import { useQuery } from '@tanstack/react-query';
import { Building2, Home, Loader2, Search, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useOrg } from '@/hooks/useOrg';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Cmd/Ctrl+K global search across clients, prospects and properties (BUILD_PLAN 8.12). */
export function SearchButton() {
  const org = useOrg();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 150);
    return () => clearTimeout(t);
  }, [text]);

  const results = useQuery({
    queryKey: ['org', org.orgSlug, 'search', q],
    queryFn: () => api<SearchResults>(`/orgs/${org.orgSlug}/search?q=${encodeURIComponent(q)}`),
    enabled: open && q.length >= 2,
    staleTime: 30_000,
  });

  const items = [
    ...(results.data?.contacts ?? []).map((c) => ({
      key: `c${c.id}`,
      to: `/${org.orgSlug}/contacts/${c.id}`,
      icon: c.kind === 'CLIENT' ? User : Building2,
      title: c.displayName,
      sub: [c.kind === 'CLIENT' ? `Client #${c.clientNumber}` : 'Prospect', c.email]
        .filter(Boolean)
        .join(' · '),
    })),
    ...(results.data?.properties ?? []).map((p) => ({
      key: `p${p.id}`,
      to: `/${org.orgSlug}/properties/${p.id}`,
      icon: Home,
      title: `${p.accountNumber} · ${p.county}`,
      sub: [p.owner, p.situsLine].filter(Boolean).join(' · '),
    })),
  ];
  const go = (to: string) => {
    setOpen(false);
    setText('');
    navigate(to);
  };
  const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full max-w-sm items-center gap-2 rounded-md border bg-card px-3 text-sm text-muted-foreground shadow-xs hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search clients, properties…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline">
          {isMac ? '⌘' : 'Ctrl'} K
        </kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[15%] translate-y-0 gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">Search</DialogTitle>
          <div className="flex items-center gap-2 border-b px-4">
            {results.isFetching ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : (
              <Search className="size-4 text-muted-foreground" />
            )}
            <input
              autoFocus
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, items.length - 1));
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                }
                if (e.key === 'Enter' && items[active]) go(items[active].to);
              }}
              placeholder="Name, client #, email, phone, account number or address"
              aria-label="Search"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-96 overflow-y-auto p-1.5">
            {q.length < 2 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                Type at least two characters.
              </p>
            ) : items.length === 0 && !results.isFetching ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                No matches for “{q}”.
              </p>
            ) : (
              <ul role="listbox" aria-label="Results">
                {items.map((it, i) => (
                  <li key={it.key} role="option" aria-selected={i === active}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(it.to)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left',
                        i === active && 'bg-accent',
                      )}
                    >
                      <it.icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{it.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {it.sub}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
