// components/listings/ItemFormSkeleton.tsx
//
// Static placeholder for `ItemForm`'s two-pane card (photo panel + details
// rail + footer actions), shared by the create and edit loading states so
// swapping in the real form causes no layout shift.

import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';

export function ItemFormSkeleton() {
  return (
    <Card className="mx-auto w-full max-w-7xl overflow-hidden lg:grid lg:h-[calc(100svh-7rem)] lg:max-h-[52rem] lg:min-h-[34rem] lg:grid-cols-[minmax(0,1.65fr)_minmax(min(340px,40%),0.95fr)] lg:grid-rows-[auto_1fr_auto]">
      <CardHeader className="lg:col-start-2 lg:row-start-1 lg:border-l lg:border-border lg:px-7 lg:pb-5 lg:pt-7">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-2 h-4 w-full max-w-xs" />
      </CardHeader>

      <CardContent className="grid gap-8 lg:contents">
        {/* Photos panel */}
        <div className="space-y-3 lg:col-start-1 lg:row-span-3 lg:row-start-1 lg:bg-muted lg:p-8">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="aspect-square w-full rounded-lg" />
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="aspect-square w-full rounded-md" />
            ))}
          </div>
        </div>

        {/* Details rail */}
        <div className="space-y-5 lg:col-start-2 lg:row-start-2 lg:border-l lg:border-border lg:px-7 lg:pb-7">
          <div className="space-y-2">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-24 w-full" />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-9 w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-9 w-full" />
            </div>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>
      </CardContent>

        <CardFooter className="flex-col-reverse items-stretch gap-2 border-t bg-muted px-6 pb-4 pt-4 sm:flex-row sm:justify-end lg:col-start-2 lg:row-start-3 lg:border-l lg:border-border lg:px-7">
        <Skeleton className="h-9 w-full sm:w-24" />
        <Skeleton className="h-9 w-full sm:w-32" />
      </CardFooter>
    </Card>
  );
}
