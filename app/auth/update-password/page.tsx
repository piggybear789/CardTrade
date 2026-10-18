import type { Metadata } from 'next';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { ResetLinkExpired, UpdatePasswordForm } from '@/components/auth/UpdatePasswordForm';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';

export const metadata: Metadata = {
  title: 'New password · NoDitto',
};

// Set a new password after redeeming a recovery link.
//
// DELIBERATELY UNDER `/auth/`, NOT `/account/`. It needs the recovery session that
// `/auth/confirm?type=recovery` just wrote, but `/account` is in `PROTECTED_PREFIXES`,
// where the onboarding gate in `proxy.ts` redirects any member without
// `onboarding_completed_at` to `/onboarding` — which would strand someone one step from
// setting the password they came here to set. Nothing is gated on middleware.
//
// THE SESSION IS CHECKED BEFORE THE FORM IS SHOWN. Without one there is nobody to
// update, and a form shown anyway has someone type a new password twice before they
// learn the link is dead. The form's action still requires the session, and still
// reports NO_SESSION if it lapses while the page is open.
export default async function UpdatePasswordPage() {
  const user = await getCachedAuthUser();
  return <AuthScreen>{user ? <UpdatePasswordForm /> : <ResetLinkExpired />}</AuthScreen>;
}
