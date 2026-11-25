/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string;
  /** "landing" builds only the public landing page (no API), for hosting it on its own. */
  readonly VITE_SITE_MODE?: 'landing' | 'app';
  /** Where "Request early access" emails go in landing mode. */
  readonly VITE_EARLY_ACCESS_EMAIL?: string;
}
