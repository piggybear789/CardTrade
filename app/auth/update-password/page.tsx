import type { Metadata } from 'next';

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
    <main className="relative flex min-h-[calc(100dvh-4rem)] items-center justify-center overflow-x-clip px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute inset-0 bg-obsidian" aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(227,192,106,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(227,192,106,0.08)_1px,transparent_1px)] [background-size:4rem_4rem] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]"
        aria-hidden="true"
      />
      <div className="relative w-full max-w-md">
        <UpdatePasswordForm />
      </div>
    </main>
  );
}
