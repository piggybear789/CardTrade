'use client';

// Guest account controls. Hidden on dedicated auth routes so the header does
// not restack Sign in / Sign up above the same form.

import { usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { SignInLink } from '@/components/layout/SignInLink';

function isAuthRoute(pathname: string): boolean {
  return (
    pathname === '/sign-in' ||
    pathname === '/sign-up' ||
    pathname === '/forgot-password' ||
    pathname.startsWith('/auth/')
  );
}

export function GuestHeaderCtas() {
  const pathname = usePathname();
  if (isAuthRoute(pathname)) return null;

  return (
    <nav aria-label="Account" className="flex items-center gap-1">
      <Button asChild variant="ghost" size="sm">
        <SignInLink>Sign in</SignInLink>
      </Button>
      <Button
        asChild
        size="sm"
        className="border-parchment/20 bg-parchment text-obsidian hover:bg-parchment/90"
      >
        <SignInLink target="/sign-up">Get started</SignInLink>
      </Button>
    </nav>
  );
}
