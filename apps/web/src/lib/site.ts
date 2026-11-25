/** Landing-only deployments have no API behind them (see vercel.json). */
export const LANDING_ONLY = import.meta.env.VITE_SITE_MODE === 'landing';

const EARLY_ACCESS_EMAIL = import.meta.env.VITE_EARLY_ACCESS_EMAIL || 'hello@example.com';

export const EARLY_ACCESS_HREF = `mailto:${EARLY_ACCESS_EMAIL}?subject=${encodeURIComponent(
  'Early access request',
)}&body=${encodeURIComponent('Firm name:\nNumber of property accounts:\nPhone:\n')}`;
