// app/trades/new/loading.tsx
//
// Offer form is a centred max-w-lg card: requested item strip, your-side
// picker, terms, footer actions.
//
// REAL LINE BOXES AND THE REAL BLOCKS, because this route is `center`: the shell
// centres the card vertically, so every pixel the placeholder is short moves the
// whole card by half of it when the form lands. It was ~70px short — the two-row
// "You offer" group was drawn as a 64px and a 40px slab, "Payment terms" and the
// running-total box were one 80px bar between them, and every label was an `h-4`
// standing in for a 22.4px `text-body` line. Below mirrors `TradeOfferForm`'s page
// layout for the common case: a single listing, a member with listings of their own,
// not a counter.

import { Skeleton, TextLines } from '@/components/ui/skeleton';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { RailPrimaryAction } from '@/components/layout/RailPrimaryAction';

/** `DialogRow`: `rounded-lg border px-cozy py-2.5` around one `text-body` line. */
function DialogRowSkeleton({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="flex w-full items-center gap-snug rounded-lg border border-border px-cozy py-2.5 text-body">
      <Skeleton className="size-4 shrink-0 rounded-sm" />
      <TextLines className="shrink-0" widths={[label]} />
      <TextLines className="ml-auto min-w-0" widths={[hint]} />
    </div>
  );
}

export default function NewTradeLoading() {
  return (
    <MarketplaceShellSkeleton
      title="Offer a Trade"
      primaryAction={
        <RailPrimaryAction href="/" glyph={null}>
          Browse Marketplace
        </RailPrimaryAction>
      }
      center
    >
      <Card className="mx-auto w-full max-w-lg">
        <CardHeader className="pb-group">
          <TextLines className="text-subhead" widths={['w-36']} />
          <TextLines className="text-body" widths={['w-64 max-w-full']} />
        </CardHeader>
        <CardContent className="space-y-group">
          {/* The requested item: 48px thumb beside an eyebrow and the title, price
              on the right. */}
          <div className="flex items-center gap-cozy rounded-lg border bg-muted p-cozy">
            <Skeleton className="size-12 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1">
              <TextLines className="text-meta" widths={['w-32']} />
              <TextLines className="text-lead" widths={['w-48 max-w-full']} />
            </div>
            <TextLines className="ml-auto shrink-0 text-body" widths={['w-14']} />
          </div>
          {/* "You offer": the legend, then the "Your listings" and "Unlisted item"
              rows. */}
          <div className="min-w-0 space-y-snug">
            <TextLines className="text-body" widths={['w-20']} />
            <DialogRowSkeleton label="w-24" hint="w-32" />
            <DialogRowSkeleton label="w-24" hint="w-48" />
          </div>
          <DialogRowSkeleton label="w-28" hint="w-16" />
          {/* Running total: You give / They give, then the verdict under a rule. */}
          <div className="rounded-lg border bg-muted p-cozy text-body">
            <div className="flex items-baseline justify-between gap-cozy">
              <TextLines widths={['w-16']} />
              <TextLines widths={['w-14']} />
            </div>
            <div className="mt-tight flex items-baseline justify-between gap-cozy">
              <TextLines widths={['w-16']} />
              <TextLines widths={['w-14']} />
            </div>
            <div className="mt-snug border-t pt-snug">
              <TextLines widths={['w-40']} />
            </div>
          </div>
        </CardContent>
        {/* Default `Button`s: 36px on touch, 32px from `md`. */}
        <CardFooter className="flex-col-reverse items-stretch gap-snug border-t bg-muted px-6 pb-group pt-group sm:flex-row sm:justify-end">
          <Skeleton className="h-9 w-full sm:w-20 md:h-8" />
          <Skeleton className="h-9 w-full sm:w-28 md:h-8" />
        </CardFooter>
      </Card>
    </MarketplaceShellSkeleton>
  );
}
