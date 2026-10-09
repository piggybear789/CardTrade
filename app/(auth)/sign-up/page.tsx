import { Suspense } from 'react';
import type { Metadata } from 'next';

import { AuthForm } from '@/components/auth/AuthForm';
import { AuthFormSkeleton } from '@/components/auth/AuthFormSkeleton';
import { AuthScreen } from '@/components/auth/AuthScreen';
import { AuthTrustPanel } from '@/components/auth/AuthTrustPanel';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

export const metadata: Metadata = {
  title: 'Create account · NoDitto',
};

// Sign-up page (Req 1.1–1.3). The form is a Client Component wrapped in a
// Suspense boundary because it reads search params via next/navigation.
export default function SignUpPage() {
  return (
    <AuthScreen aside={<AuthTrustPanel />}>
      <Suspense fallback={<AuthFormSkeleton mode="sign-up" />}>
        <AuthForm mode="sign-up" />
      </Suspense>
    </AuthScreen>
  );
}
