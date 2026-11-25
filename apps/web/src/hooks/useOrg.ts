import type { MembershipSummary } from '@app/shared';
import { createContext, useContext } from 'react';

export const OrgContext = createContext<MembershipSummary | null>(null);

/** The firm in the URL, with the current user's role in it. Only inside OrgLayout. */
export function useOrg(): MembershipSummary {
  const org = useContext(OrgContext);
  if (!org) throw new Error('useOrg() used outside OrgLayout');
  return org;
}

const LAST_ORG_KEY = 'lastOrgSlug';

export function rememberOrg(slug: string) {
  try {
    localStorage.setItem(LAST_ORG_KEY, slug);
  } catch {
    // ignore
  }
}

export function lastOrg(): string | null {
  try {
    return localStorage.getItem(LAST_ORG_KEY);
  } catch {
    return null;
  }
}
