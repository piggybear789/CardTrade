'use client';

// components/auth/RequestResetForm.tsx
//
// Ask for a password-reset link, and re-send a signup confirmation.
//
// ONE FORM FOR BOTH, because from the member's side they are the same request — "email
// me a link, I can't get in" — and they arrive here from the same dead ends: a wrong
// password, or a sign-in refused because the address was never confirmed. Splitting them
// would make the member diagnose which failure they hit before they could ask for help.
//
// ALWAYS CONFIRMS, NEVER REVEALS. The actions report success for any syntactically valid
// address, so this screen must not imply an account was found. The copy says what was
// sent and where, not whether it matched.

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon, LoaderCircleIcon, MailCheckIcon } from '@hugeicons/core-free-icons';

import { requestPasswordReset, resendConfirmation } from '@/lib/actions/auth';
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

type Intent = 'reset' | 'confirm';

export function RequestResetForm() {
  const searchParams = useSearchParams();
  // Arriving from an expired link, or from a sign-in refused as unconfirmed.
  const linkError = searchParams.get('authError');
  const initialIntent: Intent = searchParams.get('intent') === 'confirm' ? 'confirm' : 'reset';
  const initialEmail = searchParams.get('email') ?? '';

  const [intent, setIntent] = useState<Intent>(initialIntent);
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result =
        intent === 'reset'
          ? await requestPasswordReset(email)
          : await resendConfirmation(email);

      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSent(true);
    });
  }

  if (sent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-snug text-subhead">
            <HugeiconsIcon icon={MailCheckIcon} className="size-4 shrink-0 text-trust" aria-hidden />
            Check your inbox
          </CardTitle>
          <CardDescription className="text-pretty leading-relaxed">
            {/* States what was sent and where — never whether an account matched. */}
            If an account uses <span className="font-medium text-foreground">{email}</span>,
            a{' '}
            {intent === 'reset' ? 'password reset link' : 'new confirmation link'} is on
            its way. It expires shortly, so use it soon.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-cozy">
          <p className="text-body text-muted-foreground">
            Nothing after a few minutes? Check your spam folder, then request another.
          </p>
          <div className="flex flex-wrap gap-snug">
            <Button type="button" variant="outline" size="sm" onClick={() => setSent(false)}>
              Send another
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link href="/sign-in">
                <HugeiconsIcon icon={ArrowLeft01Icon} className="size-3.5" aria-hidden />
                Back to sign in
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-subhead">
          {intent === 'reset' ? 'Reset your password' : 'Resend confirmation'}
        </CardTitle>
        <CardDescription className="text-pretty leading-relaxed">
          {intent === 'reset'
            ? 'Enter your email and we’ll send a link to set a new password.'
            : 'Enter your email and we’ll send another link to confirm your address.'}
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit} method="post" noValidate>
        <CardContent className="space-y-group">
          {/* Why they landed here, when they arrived from a dead link. */}
          {linkError && !error ? (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-cozy text-body leading-relaxed text-destructive">
              {linkError}
            </p>
          ) : null}

          <div className="space-y-tight">
            <Label htmlFor="reset-email">Email</Label>
            <Input
              id="reset-email"
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              disabled={isPending}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'reset-email-error' : undefined}
            />
            {error ? (
              <p id="reset-email-error" role="alert" className="text-body text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <Button type="submit" disabled={isPending} aria-busy={isPending} className="w-full">
            {isPending ? <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden /> : null}
            {isPending
              ? 'Sending…'
              : intent === 'reset'
                ? 'Send reset link'
                : 'Send confirmation link'}
          </Button>

          {/* The other reason someone cannot get in. Kept as a quiet switch rather than
              a second page, so nobody has to diagnose their own failure first. */}
          <p className="text-center text-body text-muted-foreground">
            {intent === 'reset' ? (
              <>
                Never confirmed your email?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setIntent('confirm');
                    setError(null);
                  }}
                  className="font-medium text-foreground underline underline-offset-2"
                >
                  Resend the confirmation
                </button>
              </>
            ) : (
              <>
                Forgotten your password instead?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setIntent('reset');
                    setError(null);
                  }}
                  className="font-medium text-foreground underline underline-offset-2"
                >
                  Reset it
                </button>
              </>
            )}
          </p>

          <p className="text-center text-body">
            <Link
              href="/sign-in"
              className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </form>
    </Card>
  );
}
