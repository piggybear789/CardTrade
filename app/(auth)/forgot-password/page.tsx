import { Suspense } from 'react';
import type { Metadata } from 'next';

import { AuthFormSkeleton } from '@/components/auth/AuthFormSkeleton';
import { ForgotPasswordForm } from './ForgotPasswordForm';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

export const metadata: Metadata = {
  title: 'Forgot password · NoDitto',
};

export default function ForgotPasswordPage() {
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
          <ForgotPasswordForm />
        </Suspense>
      </div>
    </main>
  );
}
