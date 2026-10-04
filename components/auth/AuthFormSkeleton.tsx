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
          `space-y-cozy` that was here. */}
      <CardHeader className="items-center text-center">
        {/* The h1 is `text-head leading-none`, a 21px line box (the reserve). An `h-8`
            bar was 32. The width is texture and draws from the canonical set. */}
        <TextLines className="w-full text-head leading-none" widths={['w-1/2']} />
        {/* `CardDescription` is `text-body`. Sign-in's line is 49 characters, which
            wraps in the 311px the card leaves inside `p-group` on a 375px phone and
            fits on one line from `sm` — the second bar was 22px of card that the
            desktop form never had, measured as the card shrinking on swap. Hiding the
            bar collapses its line box, because the block holds nothing else.
            Sign-up's 38 characters fit on one line at every width. */}
        {/* Widths are canonical texture; the `sm:hidden` on sign-in's second line is
            load-bearing (it collapses the extra reserved line from `sm` up) and stays. */}
        <TextLines
          className="w-full text-body"
          widths={mode === 'sign-in' ? ['w-full', 'w-2/3 sm:hidden'] : ['w-2/3']}
        />
      </CardHeader>

      <CardContent className="space-y-group">
        {/* `min-h-11` on `GoogleSignInButton`, so 44px rather than a Button's 36. The
            two inputs and the submit below carry it too. */}
        <Skeleton className="h-11 w-full rounded-md" />

        {/* The "or" rule, which was missing entirely: two hairlines around a
            `text-meta` line box, 16.8px, plus its share of the 16px stack gap. */}
        <div className="flex items-center gap-cozy" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          <TextLines className="text-meta" widths={['w-4']} />
          <span className="h-px flex-1 bg-border" />
        </div>

        <div className="space-y-snug">
          <TextLines className="text-body leading-none" widths={['w-1/3']} />
          <Skeleton className="h-11 w-full rounded-md" />
        </div>

        <div className="space-y-snug">
          {/* Sign-in only. The recovery link sits beside the password label as
              `inline-flex min-h-11 items-center`, which makes the row 44px (the reserve)
              rather than the label's own 14px — sign-up has no password to recover, so
              there the row is just the label. The label/link widths are canonical
              texture. */}
          {mode === 'sign-in' ? (
            <div className="flex min-h-11 items-center justify-between gap-cozy">
              <TextLines className="text-body leading-none" widths={['w-1/3']} />
              <TextLines className="shrink-0 text-meta" widths={['w-1/3']} />
            </div>
          ) : (
            <TextLines className="text-body leading-none" widths={['w-1/3']} />
          )}
          <Skeleton className="h-11 w-full rounded-md" />
        </div>

        {/* Sign-up only: the terms checkbox, a `min-h-11` centred label whose copy
            wraps to two lines in the card's phone width. */}
        {mode === 'sign-up' ? (
          <div className="flex min-h-11 items-center justify-center gap-2.5 text-body">
            <Skeleton className="size-5 shrink-0 rounded-sm" />
            {/* The label bar is texture inside the `min-h-11` row; the `size-5` checkbox
                keeps its reserve. */}
            <Skeleton className="inline-block h-[0.9em] w-1/2 max-w-full align-middle" />
          </div>
        ) : null}
      </CardContent>

      {/* THE SUBMIT LIVES HERE. It used to be a last bar inside `CardContent`, while
          the footer got a single 16px line — 32px of placeholder against 120px of real
          footer: a `min-h-11` submit, a 16px gap, and a switch-mode line whose link is
          also `inline-flex min-h-11 items-center`. */}
      <CardFooter className="flex flex-col items-center gap-group">
        <Skeleton className="h-11 w-full rounded-md" />
        <div className="flex min-h-11 w-full items-center justify-center text-body">
          {/* Switch-mode line: texture inside the `min-h-11` row, drawn canonical. */}
          <Skeleton className="inline-block h-[0.9em] w-1/2 max-w-full align-middle" />
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
        {/* `CardTitle` is `text-subhead` — 23.8px (the reserve); the width is canonical
            texture. */}
        <TextLines className="text-subhead" widths={['w-1/2']} />
        {/* `text-body` is 22.4px a line, and both intents run past 60 characters, so the
            description wraps to two lines (the reservation); widths draw canonical. */}
        <TextLines className="text-body" widths={['w-full', 'w-2/3']} />
      </CardHeader>

      {/* No `CardFooter`: the submit and both switch links sit inside `CardContent`. */}
      <CardContent className="space-y-group">
        {/* ONE field, in `space-y-tight` (4px) — not two groups in `space-y-snug`. */}
        <div className="space-y-tight">
          <TextLines className="text-body leading-none" widths={['w-1/3']} />
          {/* `h-9 md:h-8`: this Input carries no `min-h-11`, so it sits at the
              shared field height. 28px -> 32px at `md` came with `body` at 14px. */}
          <Skeleton className="h-9 w-full rounded-md md:h-8" />
        </div>

        {/* A default `Button`, so `h-9` below `md`. */}
        <Skeleton className="h-9 w-full rounded-md" />

        {/* The intent switch (50 characters, so it wraps to two lines — the reservation)
            and the way back to sign-in. Both are plain `text-body` lines with no
            touch-target minimum; widths draw from the canonical set. */}
        <TextLines className="text-center text-body" widths={['w-full', 'w-1/2']} />
        <TextLines className="text-center text-body" widths={['w-1/3']} />
      </CardContent>
    </Card>
  );
}
