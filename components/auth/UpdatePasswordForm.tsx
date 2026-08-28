'use client';

// components/auth/UpdatePasswordForm.tsx
//
// Set a new password using the session `/auth/confirm?type=recovery` just established.
//
// The member arrives here already authenticated by the emailed token, so there is no
// current-password field — proving control of the inbox IS the proof. If that session is
// missing the action returns NO_SESSION, which means the link expired: the answer is a
// fresh link, not a retry, so that case routes back to the request form.

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { KeyRoundIcon, LoaderCircleIcon } from '@hugeicons/core-free-icons';

import { updatePassword } from '@/lib/actions/auth';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function UpdatePasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // Checked here rather than server-side: the server never needs the second copy,
    // and a mismatch is a typo to catch before a round trip.
    if (password !== confirm) {
      setError('Those passwords do not match.');
      return;
    }

    startTransition(async () => {
      const result = await updatePassword(password);
      if (!result.ok) {
        if (result.error === 'NO_SESSION') {
          setExpired(true);
          return;
        }
        setError(result.message);
        return;
      }
      
      router.push('/');
    });
  }

  if (expired) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-subhead">That link has expired</CardTitle>
          <CardDescription className="text-pretty leading-relaxed">
            Reset links are single-use and short-lived. Request a new one and it will work.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-subhead">Choose a new password</CardTitle>
        <CardDescription className="text-pretty leading-relaxed">
          You confirmed control of your inbox, so this is the last step.
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit} method="post" noValidate>
        <CardContent className="space-y-group">
          <div className="space-y-tight">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
              disabled={isPending}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'new-password-error' : undefined}
            />
          </div>

          <div className="space-y-tight">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              name="confirmPassword"
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
              required
              disabled={isPending}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'new-password-error' : undefined}
            />
            {error ? (
              <p id="new-password-error" role="alert" className="text-body text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <Button type="submit" disabled={isPending} aria-busy={isPending} className="w-full">
            {isPending ? (
              <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
            ) : (
              <HugeiconsIcon icon={KeyRoundIcon} className="size-3.5" aria-hidden />
            )}
            {isPending ? 'Saving…' : 'Save new password'}
          </Button>
        </CardContent>
      </form>
    </Card>
  );
}
