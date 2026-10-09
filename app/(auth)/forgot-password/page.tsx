import { Suspense } from 'react';
import type { Metadata } from 'next';

import { RequestResetFormSkeleton } from '@/components/auth/AuthFormSkeleton';
import { AuthScreen } from '@/components/auth/AuthScreen';
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
    <AuthScreen>
      {/* The credentials skeleton describes `AuthForm` — two `min-h-11` fields, a
          Google button and a CardFooter — none of which this form has. */}
      <Suspense fallback={<RequestResetFormSkeleton />}>
        <RequestResetForm />
      </Suspense>
    </AuthScreen>
  );
}
