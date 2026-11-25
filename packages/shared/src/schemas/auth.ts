import { z } from 'zod';
import { ORG_ROLES } from '../roles.js';
import { Email, Password } from './common.js';

export const SignUpInput = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(120),
  email: Email,
  password: Password,
});
export type SignUpInput = z.infer<typeof SignUpInput>;

export const LoginInput = z.object({
  email: Email,
  password: z.string().min(1, 'Enter your password.'),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const TokenInput = z.object({ token: z.string().min(10).max(200) });

export const ForgotPasswordInput = z.object({ email: Email });
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordInput>;

export const ResetPasswordInput = z.object({
  token: z.string().min(10).max(200),
  password: Password,
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordInput>;

export const MembershipSummary = z.object({
  orgId: z.number(),
  orgSlug: z.string(),
  orgName: z.string(),
  role: z.enum(ORG_ROLES),
});
export type MembershipSummary = z.infer<typeof MembershipSummary>;

export const Me = z.object({
  user: z.object({
    id: z.number(),
    email: z.string(),
    name: z.string(),
    emailVerified: z.boolean(),
    isSuperAdmin: z.boolean(),
  }),
  memberships: z.array(MembershipSummary),
});
export type Me = z.infer<typeof Me>;
