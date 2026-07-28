'use client';

// components/layout/SignOutButton.tsx
//
// Tiny client control that ends the current session via the `signOut` Server
// Action, then refreshes so every Server Component (including SiteHeader) re-
// reads the now-signed-out session. Kept intentionally small so the rest of the
// header can stay a Server Component.

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';

import { signOut } from '@/lib/actions/auth';
import { Button } from '@/components/ui/button';

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSignOut() {
    startTransition(async () => {
      await signOut();
      // Re-run Server Components with the cleared session, then land on home.
      router.replace('/');
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={handleSignOut}
      disabled={isPending}
      aria-label="Sign out"
      className={className}
    >
      <LogOut className="size-4" aria-hidden />
      <span>{isPending ? 'Signing out…' : 'Sign out'}</span>
    </Button>
  );
}
