import type { Metadata } from 'next';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { UpdatePasswordForm } from '@/components/auth/UpdatePasswordForm';

export const metadata: Metadata = {
  title: 'New password · NoDitto',
};

// Set a new password after redeeming a recovery link.
//
// DELIBERATELY UNDER `/auth/`, NOT `/account/`. It needs the recovery session that
// `/auth/confirm?type=recovery` just wrote, but `/account` is in `PROTECTED_PREFIXES`,
// where the onboarding gate in `proxy.ts` redirects any member without
// `onboarding_completed_at` to `/onboarding` — which would strand someone one step from
// setting the password they came here to set. The form's own action requires the session
// and reports NO_SESSION when the link has expired, so nothing is gated on middleware.
export default function UpdatePasswordPage() {
  return (
    <AuthScreen>
      <UpdatePasswordForm />
    </AuthScreen>
  );
}
