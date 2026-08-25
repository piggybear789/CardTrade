import { Suspense } from 'react';
import type { Metadata } from 'next';

import { AuthFormSkeleton } from '@/components/auth/AuthFormSkeleton';
import { RequestResetForm } from '@/components/auth/RequestResetForm';

export const metadata: Metadata = {
  title: 'Reset password · NoDitto',
};

// Password reset / resend confirmation (Req 1.7 recovery path).
//
// PUBLIC BY NECESSITY: someone who cannot sign in must be able to reach it, so it sits
// outside `PROTECTED_PREFIXES` in `proxy.ts`. The form is a Client Component in a
// Suspense boundary because it reads search params (`authError`, `intent`, `email`) that
// the failing link or sign-in attempt passes along.
export default function ForgotPasswordPage() {
  return (
    <main className="relative flex min-h-[calc(100dvh-4rem-env(safe-area-inset-top))] items-center justify-center overflow-x-clip px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute inset-0 bg-obsidian" aria-hidden="true" />
      <div
        className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(227,192,106,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(227,192,106,0.08)_1px,transparent_1px)] [background-size:4rem_4rem] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]"
        aria-hidden="true"
      />
      <div className="relative w-full max-w-md">
        <Suspense fallback={<AuthFormSkeleton />}>
          <RequestResetForm />
        </Suspense>
      </div>
    </main>
  );
}
