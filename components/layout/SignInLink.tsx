'use client';

// components/layout/SignInLink.tsx
//
// A sign-in (or sign-up) link that preserves the current URL as `redirectTo`,
// so the user lands back where they were after authenticating rather than
// falling through to the default /listings destination.

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function SignInLink({
  children,
  className,
  target = '/sign-in',
  redirectTo,
}: {
  children: React.ReactNode;
  className?: string;
  /** Auth page to link to. Defaults to `/sign-in`. */
  target?: '/sign-in' | '/sign-up';
  /** Override the post-auth return path. Defaults to the current pathname. */
  redirectTo?: string;
}) {
  const pathname = usePathname();

  // Don't set redirectTo if the user is already on an auth page — that would
  // create a redirect loop back to sign-in/sign-up.
  const isAuthPage = pathname.startsWith('/sign-in') || pathname.startsWith('/sign-up');
  const dest = redirectTo ?? pathname;
  const href = isAuthPage ? target : `${target}?redirectTo=${encodeURIComponent(dest)}`;

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
