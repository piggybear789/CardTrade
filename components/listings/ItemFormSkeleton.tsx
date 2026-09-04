// components/listings/ItemFormSkeleton.tsx
//
// Static placeholder for `ItemForm`'s two-pane card (photo panel + details
// rail + footer actions), shared by the create and edit loading states so
// swapping in the real form causes no layout shift.
//
// IT TAKES `mode` FOR THE SAME REASON `ItemForm` DOES. Three parts of that form
// exist in one mode and not the other — the card header, the photo filmstrip and
// the submit button — and a mode-blind placeholder drew all three on
// `/listings/new`, where the real form renders none of them on a phone. That was
// roughly 200px of card the form never draws, so every field under it arrived
// high.


import { Skeleton, TextLines } from '@/components/ui/skeleton';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function ItemFormSkeleton({ mode }: { mode: 'create' | 'edit' }) {
  const isCreate = mode === 'create';

  // `min-w-0` matches `ItemForm`'s own card: without it a grid child refuses to shrink
  // below its content, so the skeleton can be fractionally wider than the form it
  // stands in for on a narrow viewport.
  return (
    <Card className="mx-auto w-full min-w-0 max-w-7xl overflow-hidden lg:grid lg:h-[calc(100svh-7rem)] lg:max-h-[52rem] lg:min-h-[34rem] lg:grid-cols-[minmax(0,1.65fr)_minmax(min(340px,40%),0.95fr)] lg:grid-rows-[auto_1fr_auto]">
      {/* `max-md:hidden` in create mode, matching `ItemForm`: on `/listings/new`
          the title lives in the phone chrome, so a header drawn here is ~80px of
          card that never resolves to anything. */}
      <CardHeader
        className={cn(
          'lg:col-start-2 lg:row-start-1 lg:border-l lg:border-border lg:px-7 lg:pb-5 lg:pt-7',
          isCreate && 'max-md:hidden',
        )}
      >
        {/* `CardTitle` is `text-subhead`; `CardDescription` is `hidden md:block`
            in BOTH modes, so nothing below `md` may stand in for it. Bars sit in
            real line boxes rather than the `h-6`/`h-4` they were, and
            `CardHeader`'s own `space-y-snug` sets the gap. */}
        <TextLines className="text-subhead" widths={['w-40']} />
        <TextLines className="hidden text-body md:block" widths={['w-full']} />
      </CardHeader>

      {/* `gap-5`, matching `ItemForm`'s `CardContent`. `gap-8` put 12px of extra
          air between the photo panel and the details rail on every phone. */}
      <CardContent className="grid gap-5 lg:contents">
        {/* Photos panel */}
        {/* `lg:bg-card` and the cover's aspect ratio both mirror ItemForm: the
            panel used to paint `lg:bg-muted`, so it visibly changed colour on
            swap, and the cover was `aspect-square` against the form's
            `aspect-[16/10] max-h-[22svh]` — a large jump on phones. */}
        <div className="space-y-3 lg:col-start-1 lg:row-span-3 lg:row-start-1 lg:bg-card lg:p-8">
          {/* The `Photos` label is a 13px `leading-none` `Label`; the count under
              it is a `text-body` paragraph, so 20.8px. Both were `h-4`. */}
          <TextLines className="text-body leading-none" widths={['w-16']} />
          <TextLines className="text-body" widths={['w-48']} />
          <Skeleton className="aspect-[16/10] max-h-[22svh] w-full rounded-lg md:aspect-auto md:min-h-[10rem] md:max-h-none" />
          {/* The filmstrip renders only when the form already holds a photo
              (`totalImages > 0`), which on create is never true. Drawing it there
              reserved a whole thumbnail row above fields that then jumped up. */}
          {isCreate ? null : (
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="aspect-square w-full rounded-md" />
              ))}
            </div>
          )}
        </div>

        {/* Details rail — five blocks in `ItemForm`'s order: listing kind,
            description, category + condition, price, `Based near`.

            `lg:min-h-0 lg:overflow-y-auto` because this is the card's `1fr` row
            and the card's height is definite: a grid item defaults to
            `min-height:auto`, so without it the rail grows past the row and the
            card clips it instead of scrolling the way the real one does. */}
        <div className="space-y-5 lg:col-start-2 lg:row-start-2 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-border lg:px-7 lg:pb-7">
          {/* Listing kind. This block was absent entirely, so the whole rail
              under it — every field the seller actually fills in — sat ~66px
              high in both modes. The tiles carry `ChoiceTile`'s border and
              `p-snug md:p-cozy` rather than a measured height, so they follow
              the real tile across the breakpoint on their own. */}
          <div className="space-y-2">
            <TextLines className="text-body leading-none" widths={['w-40']} />
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 2 }, (_, index) => (
                <div
                  key={index}
                  className="rounded-md border border-border p-snug md:p-cozy"
                >
                  <TextLines className="text-center text-body" widths={['w-2/3']} />
                </div>
              ))}
            </div>
            {/* "This can't be changed after a listing is created." — inside the
                fieldset, so it sits at the block's own `space-y-2` rather than the
                rail's `space-y-5`. Edit mode only. */}
            {isCreate ? null : <TextLines className="text-body" widths={['w-4/5']} />}
          </div>

          <div className="space-y-2">
            <TextLines className="text-body leading-none" widths={['w-24']} />
            {/* `Textarea rows={4}`: four lines of `text-lead` (24px) plus `py-2`
                and the border is 114px on touch, and four of `text-body` (20.8px)
                is 101px wherever there is a real pointer. Follows the Textarea's
                own `pointer-fine:` gate, not a width breakpoint. */}
            <Skeleton className="h-[114px] w-full pointer-fine:h-[101px]" />
            {/* "The first line is used as the listing title in the catalog." —
                two lines at the width this rail ever has on a phone or at `lg`. */}
            <TextLines className="text-body" widths={['w-full', 'w-2/5']} />
          </div>

          {/* `gap-3`, matching `ItemForm`. `gap-5` here added 8px between
              Category and Condition, which stack on a phone. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <TextLines className="text-body leading-none" widths={['w-20']} />
              {/* `h-9 md:h-7`, matching `SelectTrigger` — which now matches
                  `Button`, since fields and controls share one height scale. */}
              <Skeleton className="h-9 w-full md:h-7" />
            </div>
            <div className="space-y-2">
              <TextLines className="text-body leading-none" widths={['w-20']} />
              <Skeleton className="h-9 w-full md:h-7" />
            </div>
          </div>

          <div className="space-y-2">
            <TextLines className="text-body leading-none" widths={['w-12']} />
            {/* `MoneyInput` is an `Input` behind a currency prefix: `h-9 md:h-7`. */}
            <Skeleton className="h-9 w-full md:h-7" />
          </div>

          {/* `Based near` — a `PlacePicker`, which is a `Label` over a
              `PlaceSearch` input. The rail used to stop at the price, so it ran
              61px short of the form on every load. */}
          <div className="space-y-2">
            <TextLines className="text-body leading-none" widths={['w-24']} />
            <Skeleton className="h-9 w-full md:h-7" />
          </div>
        </div>
      </CardContent>

      {/* `bg-card` and `flex-col`, both `ItemForm`'s. `bg-muted` here flashed a
          tinted band to white on swap, and `flex-col-reverse` stacked the submit
          above Cancel — the reverse of where the two settle. */}
      <CardFooter className="flex-col items-stretch gap-2 border-t bg-card px-6 pb-4 pt-4 sm:flex-row sm:justify-end lg:col-start-2 lg:row-start-3 lg:border-l lg:border-border lg:px-7">
        {/* `h-9 md:h-7`, `Button`'s default size. */}
        <Skeleton className="h-9 w-full sm:w-24 md:h-7" />
        {/* Create's submit is `hidden … md:inline-flex`: below `md` the Sell
            action lives in the phone chrome, so the footer holds Cancel alone. */}
        <Skeleton
          className={cn('h-9 w-full sm:w-32 md:h-7', isCreate && 'max-md:hidden')}
        />
      </CardFooter>
    </Card>
  );
}
