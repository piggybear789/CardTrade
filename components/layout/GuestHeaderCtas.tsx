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
      <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
        <SignInLink>Sign in</SignInLink>
      </Button>
      <Button
        asChild
        size="sm"
        className="min-h-11 border-parchment/20 bg-parchment text-obsidian hover:bg-parchment/90 md:min-h-9"
      >
        <SignInLink target="/sign-up">
          <span className="hidden md:inline">Get started</span>
          <span className="md:hidden">Sign up</span>
        </SignInLink>
      </Button>
    </nav>
  );
}
