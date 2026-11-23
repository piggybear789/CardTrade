import { Suspense } from 'react';
import type { Metadata } from 'next';

import { AuthForm } from '@/components/auth/AuthForm';
import { AuthScreen } from '@/components/auth/AuthScreen';
import { AuthTrustPanel } from '@/components/auth/AuthTrustPanel';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

export const metadata: Metadata = {
  title: 'Sign in · NoDitto',
};

// Sign-in page (Req 1.1, 1.7). The form is a Client Component wrapped in a
// Suspense boundary because it reads the `redirectTo` search param.
export default function SignInPage() {
  return (
    <AuthScreen aside={<AuthTrustPanel />}>
      <Suspense fallback={null}>
        <AuthForm mode="sign-in" />
      </Suspense>
    </AuthScreen>
  );
}
