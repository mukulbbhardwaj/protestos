import { createHash, randomBytes } from 'node:crypto';

/** A URL-safe secret for cookies and emailed links. Only its hash is stored. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
