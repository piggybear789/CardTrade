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
          {/* Title/description are texture in their own line boxes, drawn canonical. */}
          <TextLines className="text-subhead" widths={['w-1/2']} />
          <TextLines className="text-body" widths={['w-2/3']} />
        </CardHeader>
        <CardContent className="space-y-group">
          {/* The requested item: 48px thumb beside an eyebrow and the title, price
              on the right. The thumb is geometry; the text runs are canonical texture. */}
          <div className="flex items-center gap-cozy rounded-lg border bg-muted p-cozy">
            <Skeleton className="size-12 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1">
              <TextLines className="text-meta" widths={['w-1/3']} />
              <TextLines className="text-lead" widths={['w-2/3']} />
            </div>
            <TextLines className="ml-auto shrink-0 text-body" widths={['w-1/3']} />
          </div>
          {/* "You offer": the legend, then the "Your listings" and "Unlisted item"
              rows. Legend and the DialogRow label/hint runs are canonical texture. */}
          <div className="min-w-0 space-y-snug">
            <TextLines className="text-body" widths={['w-1/3']} />
            <DialogRowSkeleton label="w-1/3" hint="w-1/3" />
            <DialogRowSkeleton label="w-1/3" hint="w-1/2" />
          </div>
          <DialogRowSkeleton label="w-1/3" hint="w-1/3" />
          {/* Running total: You give / They give, then the verdict under a rule. All
              figures are texture in their own line boxes, drawn canonical. */}
          <div className="rounded-lg border bg-muted p-cozy text-body">
            <div className="flex items-baseline justify-between gap-cozy">
              <TextLines widths={['w-1/3']} />
              <TextLines widths={['w-1/3']} />
            </div>
            <div className="mt-tight flex items-baseline justify-between gap-cozy">
              <TextLines widths={['w-1/3']} />
              <TextLines widths={['w-1/3']} />
            </div>
            <div className="mt-snug border-t pt-snug">
              <TextLines widths={['w-1/2']} />
            </div>
          </div>
        </CardContent>
        {/* Default `Button`s: 40px on touch, 36px from `md`. */}
        <CardFooter className="flex-col-reverse items-stretch gap-snug border-t bg-muted px-6 pb-group pt-group sm:flex-row sm:justify-end">
          <Skeleton className="h-10 w-full sm:w-20 md:h-9" />
          <Skeleton className="h-10 w-full sm:w-28 md:h-9" />
        </CardFooter>
      </Card>
    </MarketplaceShellSkeleton>
  );
}
