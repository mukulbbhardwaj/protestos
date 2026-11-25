import { createBrowserRouter, Navigate } from 'react-router-dom';
import {
  GuestOnly,
  HomeRedirect,
  NotFoundPage,
  OrgLayout,
  RequireAuth,
  RequireRole,
} from '@/components/layout/guards';
import { MODULES } from '@/modules';
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage';
import { SignUpPage } from '@/pages/auth/SignUpPage';
import { VerifyEmailPage } from '@/pages/auth/VerifyEmailPage';
import { DevMailboxPage } from '@/pages/dev/DevMailboxPage';
import { AcceptInvitePage } from '@/pages/invite/AcceptInvitePage';
import { OnboardingPage } from '@/pages/onboarding/OnboardingPage';
import { DashboardPage } from '@/pages/org/DashboardPage';
import { FinancePage } from '@/pages/org/FinancePage';
import { ModulePage } from '@/pages/org/ModulePage';
import { AuditLogPage } from '@/pages/org/settings/AuditLogPage';
import { GeneralSettingsPage } from '@/pages/org/settings/GeneralSettingsPage';
import { SettingsLayout } from '@/pages/org/settings/SettingsLayout';
import { TeamSettingsPage } from '@/pages/org/settings/TeamSettingsPage';

const placeholderRoutes = MODULES.filter((m) => m.comingIn && m.key !== 'finance').map((m) => ({
  path: m.path,
  element: (
    <RequireRole minimum={m.minRole}>
      <ModulePage module={m} />
    </RequireRole>
  ),
}));

export const router = createBrowserRouter([
  {
    element: <GuestOnly />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/signup', element: <SignUpPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
    ],
  },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/verify-email', element: <VerifyEmailPage /> },
  { path: '/invite/:token', element: <AcceptInvitePage /> },
  ...(import.meta.env.DEV ? [{ path: '/dev/mailbox', element: <DevMailboxPage /> }] : []),
  {
    element: <RequireAuth />,
    children: [
      { path: '/', element: <HomeRedirect /> },
      { path: '/onboarding', element: <OnboardingPage /> },
      {
        path: '/:orgSlug',
        element: <OrgLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          ...placeholderRoutes,
          {
            path: 'finance',
            element: (
              <RequireRole minimum="ADMIN">
                <FinancePage />
              </RequireRole>
            ),
          },
          {
            path: 'settings',
            element: <SettingsLayout />,
            children: [
              { index: true, element: <GeneralSettingsPage /> },
              { path: 'team', element: <TeamSettingsPage /> },
              { path: 'audit-log', element: <AuditLogPage /> },
            ],
          },
          { path: '*', element: <Navigate to=".." replace /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
