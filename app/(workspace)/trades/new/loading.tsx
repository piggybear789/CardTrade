// app/trades/new/loading.tsx
//
// Offer form is a centred max-w-lg card: requested item strip, your-side
// picker, terms, footer actions.

import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { RailPrimaryAction } from '@/components/layout/RailPrimaryAction';

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
        <CardHeader className="pb-4">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="mt-2 h-4 w-64 max-w-full" />
        </CardHeader>
        {/* `space-y-group`, matching `TradeOfferForm`'s CardContent. `space-y-5` put
            an extra 4px between every block. */}
        <CardContent className="space-y-group">
          <div className="flex items-center gap-3 rounded-lg border bg-muted p-3">
            <Skeleton className="size-12 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-4 w-48" />
            </div>
            <Skeleton className="h-4 w-16 shrink-0" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-16 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-20 w-full rounded-md" />
          </div>
        </CardContent>
        <CardFooter className="flex-col-reverse items-stretch gap-2 border-t bg-muted px-6 pb-4 pt-4 sm:flex-row sm:justify-end">
          <Skeleton className="h-9 w-full sm:w-24" />
          <Skeleton className="h-9 w-full sm:w-32" />
        </CardFooter>
      </Card>
    </MarketplaceShellSkeleton>
  );
}
