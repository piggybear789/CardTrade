// components/auth/AuthFormSkeleton.tsx
//
// Suspense fallbacks for the auth cards, held open while `useSearchParams` resolves.
//
// TWO COMPONENTS, NOT ONE WITH A FLAG. `/sign-in` and `/sign-up` render `AuthForm`;
// `/forgot-password` renders `RequestResetForm`. Those two share the Card and nothing
// inside it — one has a Google button, an "or" rule, two `min-h-11` fields and a
// CardFooter, the other has a single 40px field, no footer, and a left-aligned header.
// One skeleton stood in for both, so on `/forgot-password` it invented a second field
// group and a footer that never arrive, and on `/sign-in` it put the submit in the wrong
// half of the card. Neither can be fixed without breaking the other, so they are split.

import { Skeleton, TextLines } from '@/components/ui/skeleton';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';


/**
 * `AuthForm` on `/sign-in` and `/sign-up`.
 *
 * Takes the same `mode` the form does, because two of the card's rows exist on
 * one route only: the recovery link beside the password label is sign-in's, and
 * the terms checkbox is sign-up's. Both are 44px. Without the prop the skeleton
 * has to be wrong on one route or the other, and the pages already have the
 * value to hand — they pass it to `AuthForm` on the next line.
 */
export function AuthFormSkeleton({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  return (
    <Card
      className="w-full max-w-md"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      <span className="sr-only">Loading…</span>

      {/* `items-center text-center` and the header's own `space-y-snug` — not the
          `space-y-3` that was here. */}
      <CardHeader className="items-center text-center">
        {/* The h1 is `text-head leading-none`, a 21px line box. An `h-8` bar was 32. */}
        <TextLines className="w-full text-head leading-none" widths={['w-40']} />
        {/* `CardDescription` is `text-body`. Sign-in's line is 49 characters, which
            wraps in the 311px the card leaves inside `p-group` on a 375px phone. */}
        <TextLines className="w-full text-body" widths={['w-full', 'w-2/3']} />
      </CardHeader>

      <CardContent className="space-y-4">
        {/* `min-h-11` on `GoogleSignInButton`, so 44px rather than a Button's 36. The
            two inputs and the submit below carry it too. */}
        <Skeleton className="h-11 w-full rounded-md" />

        {/* The "or" rule, which was missing entirely: two hairlines around a
            `text-meta` line box, 16.8px, plus its share of the 16px stack gap. */}
        <div className="flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          <TextLines className="text-meta" widths={['w-4']} />
          <span className="h-px flex-1 bg-border" />
        </div>

        <div className="space-y-2">
          <TextLines className="text-body leading-none" widths={['w-14']} />
          <Skeleton className="h-11 w-full rounded-md" />
        </div>

        <div className="space-y-2">
          {/* Sign-in only. The recovery link sits beside the password label as
              `inline-flex min-h-11 items-center`, which makes the row 44px rather
              than the label's own 13px — sign-up has no password to recover, so
              there the row is just the label. */}
          {mode === 'sign-in' ? (
            <div className="flex min-h-11 items-center justify-between gap-cozy">
              <TextLines className="text-body leading-none" widths={['w-20']} />
              <TextLines className="shrink-0 text-meta" widths={['w-24']} />
            </div>
          ) : (
            <TextLines className="text-body leading-none" widths={['w-20']} />
          )}
          <Skeleton className="h-11 w-full rounded-md" />
        </div>

        {/* Sign-up only: the terms checkbox, a `min-h-11` centred label whose copy
            wraps to two lines in the card's phone width. */}
        {mode === 'sign-up' ? (
          <div className="flex min-h-11 items-center justify-center gap-2.5 text-body">
            <Skeleton className="size-5 shrink-0 rounded-sm" />
            <Skeleton className="inline-block h-[0.9em] w-48 max-w-full align-middle" />
          </div>
        ) : null}
      </CardContent>

      {/* THE SUBMIT LIVES HERE. It used to be a last bar inside `CardContent`, while
          the footer got a single 16px line — 32px of placeholder against 120px of real
          footer: a `min-h-11` submit, a 16px gap, and a switch-mode line whose link is
          also `inline-flex min-h-11 items-center`. */}
      <CardFooter className="flex flex-col items-center gap-4">
        <Skeleton className="h-11 w-full rounded-md" />
        <div className="flex min-h-11 w-full items-center justify-center text-body">
          <Skeleton className="inline-block h-[0.9em] w-52 max-w-full align-middle" />
        </div>
      </CardFooter>
    </Card>
  );
}

/** `RequestResetForm` on `/forgot-password`. */
export function RequestResetFormSkeleton() {
  return (
    <Card role="status" aria-busy="true" aria-label="Loading">
      <span className="sr-only">Loading…</span>

      {/* A bare `CardHeader`: this form does not centre its header. */}
      <CardHeader>
        {/* `CardTitle` is `text-subhead` — 23.8px. */}
        <TextLines className="text-subhead" widths={['w-52']} />
        {/* `leading-relaxed` over `text-body` is 21.1px a line, and both intents run
            past 60 characters, so the description wraps. */}
        <TextLines className="text-body leading-relaxed" widths={['w-full', 'w-3/4']} />
      </CardHeader>

      {/* No `CardFooter`: the submit and both switch links sit inside `CardContent`. */}
      <CardContent className="space-y-group">
        {/* ONE field, in `space-y-tight` (4px) — not two groups in `space-y-2`. */}
        <div className="space-y-tight">
          <TextLines className="text-body leading-none" widths={['w-14']} />
          {/* `h-10`: this Input carries no `min-h-11`. */}
          <Skeleton className="h-10 w-full rounded-md" />
        </div>

        {/* A default `Button`, so `h-9` below `md`. */}
        <Skeleton className="h-9 w-full rounded-md" />

        {/* The intent switch (50 characters, so it wraps) and the way back to sign-in.
            Both are plain `text-body` lines with no touch-target minimum. */}
        <TextLines className="text-center text-body" widths={['w-full', 'w-1/2']} />
        <TextLines className="text-center text-body" widths={['w-32']} />
      </CardContent>
    </Card>
  );
}
