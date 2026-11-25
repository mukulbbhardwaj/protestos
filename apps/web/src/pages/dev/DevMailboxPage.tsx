import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Inbox, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/layout/Logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface DevMail {
  id: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  tag?: string;
  sentAt: string;
}

/** Local development only: emails the API would have sent (verification, resets, invites). */
export function DevMailboxPage() {
  const { data, refetch, isFetching, error } = useQuery({
    queryKey: ['dev-mail'],
    queryFn: () => api<{ messages: DevMail[] }>('/dev/mail'),
    refetchInterval: 3000,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const messages = data?.messages ?? [];
  const selected = messages.find((m) => m.id === selectedId) ?? messages[0];
  const links = selected?.text.match(/https?:\/\/\S+/g) ?? [];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <Link to="/">
          <Logo />
        </Link>
        <Badge variant="warning">Dev mailbox</Badge>
        <p className="hidden text-sm text-muted-foreground sm:block">
          Emails stay on this machine. Nothing is really sent.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn(isFetching && 'animate-spin')} /> Refresh
        </Button>
      </header>
      {error ? (
        <p className="p-8 text-sm text-destructive">{error.message}</p>
      ) : messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-sm text-muted-foreground">
          <Inbox className="mb-2 size-6" /> No emails yet. Sign up, reset a password or invite
          someone.
        </div>
      ) : (
        <div className="grid flex-1 md:grid-cols-[22rem_1fr]">
          <ul className="max-h-[calc(100vh-57px)] overflow-y-auto border-r">
            {messages.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(m.id)}
                  className={cn(
                    'w-full border-b px-4 py-3 text-left hover:bg-muted/50',
                    selected?.id === m.id && 'bg-muted',
                  )}
                >
                  <p className="truncate text-sm font-medium">{m.subject}</p>
                  <p className="truncate text-xs text-muted-foreground">To {m.to}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(m.sentAt)}</p>
                </button>
              </li>
            ))}
          </ul>
          {selected && (
            <section className="flex flex-col">
              <div className="border-b px-6 py-4">
                <h1 className="font-semibold">{selected.subject}</h1>
                <p className="text-sm text-muted-foreground">To {selected.to}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {links.map((url) => (
                    <Button key={url} asChild size="sm">
                      <a href={url}>
                        <ExternalLink /> Open link in this tab
                      </a>
                    </Button>
                  ))}
                </div>
              </div>
              <iframe
                title="Email preview"
                sandbox=""
                srcDoc={selected.html}
                className="min-h-[480px] w-full flex-1 bg-white"
              />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
