import { APP_CONFIG, SENTRY_DATA_COLLECTION } from '@app/shared';
import * as Sentry from '@sentry/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { ApiError } from '@/lib/api';
import { applyTheme } from '@/lib/theme';
import './index.css';

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    dataCollection: SENTRY_DATA_COLLECTION,
  });
}

document.title = APP_CONFIG.displayName;
applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't retry what won't change on retry (auth, permissions, not found).
      retry: (count, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

// Vite inlines VITE_SITE_MODE at build time, so a landing build never bundles the app.
const { router } =
  import.meta.env.VITE_SITE_MODE === 'landing'
    ? await import('@/landing-router')
    : await import('@/router');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster richColors position="bottom-right" />
    </QueryClientProvider>
  </StrictMode>,
);
