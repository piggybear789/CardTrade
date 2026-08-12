import { Suspense } from 'react';
import type { Metadata } from 'next';

import { AuthForm } from '@/components/auth/AuthForm';
import { AuthFormSkeleton } from '@/components/auth/AuthFormSkeleton';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

export const metadata: Metadata = {
  title: 'Create account · NoDitto',
};

// Sign-up page (Req 1.1–1.3). The form is a Client Component wrapped in a
// Suspense boundary because it reads search params via next/navigation.
export default function SignUpPage() {
  return (
    <main className="relative flex min-h-[calc(100dvh-4rem)] items-center justify-center overflow-x-clip px-4 py-8 sm:px-6">
      <div
        className="pointer-events-none absolute inset-0 bg-obsidian"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(227,192,106,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(227,192,106,0.08)_1px,transparent_1px)] [background-size:4rem_4rem] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]"
        aria-hidden="true"
      />
      <div className="relative w-full max-w-md">
        <Suspense fallback={<AuthFormSkeleton />}>
          <AuthForm mode="sign-up" />
        </Suspense>
      </div>
    </main>
  );
}
