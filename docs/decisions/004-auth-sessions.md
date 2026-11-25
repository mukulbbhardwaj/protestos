# 004: In-house session auth (not Better Auth)

Status: accepted (M1)

## Context

The plan allows Better Auth or "Lucia-style sessions written in-house". We need email and
password login, email verification, password reset and invitations, with integer ids (for the
RLS casts) and httpOnly cookies.

## Decision

Write it in-house. It is about 250 lines (`apps/api/src/services/auth.ts`):

- **Passwords:** scrypt from `node:crypto` (N=16384, r=8, p=1, 16-byte salt). No native
  dependency. Stored as `scrypt$N$r$p$salt$hash`, so the parameters can be raised later.
- **Sessions:** a `Session` table. The cookie `sid` holds a random 32-byte token; the
  database stores only its SHA-256. Cookies are httpOnly and SameSite=Lax, and Secure when
  `APP_URL` is https. Lifetime is 30 days, sliding forward at most once a day.
- **Single-use tokens** (email verification 24h, password reset 1h) live in `AuthToken`, also
  hashed. Issuing a new token voids older ones of the same kind. A password reset signs out
  every session.
- **Login** returns the same error for "no such user" and "wrong password", and runs a dummy
  hash for unknown emails so response times match. Login, sign-up and reset endpoints are
  rate limited per IP.
- **CSRF:** SameSite=Lax plus an Origin check on every state-changing request.

## Why not Better Auth

It brings its own tables and id strategy, its own HTTP handler and a plugin model. Fitting
that around integer ids, Fastify, our error format and RLS would cost about as much as this
code, and we would own less of the security-critical path.

## Consequences

- We own the security of this code. Reviewed by tests in `apps/api/test/auth.test.ts`.
- Adding SSO or 2FA later is our work, not a plugin.
