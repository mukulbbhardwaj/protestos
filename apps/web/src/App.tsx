import { APP_CONFIG } from '@app/shared';
import { useEffect, useState } from 'react';
import { fetchHealth, type HealthState } from './lib/api';

export function App() {
  const [health, setHealth] = useState<HealthState>('loading');

  useEffect(() => {
    document.title = APP_CONFIG.displayName;
    void fetchHealth().then(setHealth);
  }, []);

  return (
    <main className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">{APP_CONFIG.displayName}</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-400">
          Property tax protest management for consulting firms.
        </p>
        <p
          data-testid="api-status"
          className={`mt-8 inline-block rounded px-2 py-1 text-sm ${
            health === 'ok'
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100'
              : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100'
          }`}
        >
          API: {health}
        </p>
      </div>
    </main>
  );
}
