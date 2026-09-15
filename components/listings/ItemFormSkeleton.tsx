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
    // `overflow-clip` and NO `lg:max-h`, both matching `ItemForm`. The ceiling was
    // `52rem` there and was removed so a tall display uses its height; leaving it here
    // means the placeholder stops at 832px and the real card then jumps taller.
    // `clip` rather than `hidden` for the same reason the form gives: `hidden` makes
    // this a scroll container on both axes.
    <Card className="mx-auto w-full min-w-0 max-w-7xl overflow-clip lg:grid lg:h-[calc(100dvh-8.25rem-var(--keyboard-inset,0px))] lg:min-h-[34rem] lg:grid-cols-[minmax(0,1.65fr)_minmax(min(340px,40%),0.95fr)] lg:grid-rows-[auto_1fr_auto]">
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
          air between the photo panel and the details rail on every phone.
          `grid-cols-1` also matches `ItemForm`: it pins the stacked mobile column
          to `minmax(0, 1fr)` so it tracks the card's width rather than its
          content, keeping the placeholder the same width as the form it stands in
          for. */}
      <CardContent className="grid grid-cols-1 gap-5 lg:contents">
        {/* Photos panel */}
        {/* `lg:bg-card` and the cover's aspect ratio both mirror ItemForm: the
            panel used to paint `lg:bg-muted`, so it visibly changed colour on
            swap, and the cover was `aspect-square` against the form's
            `aspect-[16/10] max-h-[22svh]` — a large jump on phones. */}
        {/* `flex flex-col gap-*`, matching the form's column — it moved off `space-y`
            and onto `gap`, and to `group` (16px) at `lg`. A 12px rhythm here against a
            16px one there shifts every element below the label on swap. */}
        <div className="flex flex-col gap-cozy lg:col-start-1 lg:row-span-3 lg:row-start-1 lg:gap-group lg:bg-card lg:p-8">
          {/* The `Photos` label, a 14px `leading-none` `Label`. It was `h-4`, which
              is 16px against a 14px line.
              
              ONE LINE, NOT TWO. A second `w-48` bar stood for the "Add 1–10 photos.
              N selected." paragraph under the label; that line was removed from
              `ItemForm`, so reserving 22.4px for it here would drop the whole panel
              on swap. */}
          <TextLines className="text-body leading-none" widths={['w-16']} />

          {/* COVER AND FILMSTRIP SIDE BY SIDE BELOW `lg`, stacked from `lg` — the
              shape `ItemForm` now uses, via the same `lg:contents` trick so this
              wrapper dissolves on desktop.
              
              The row carries the aspect ratio, exactly as the form does: `15/14` once
              there is a photo, because the cover takes two thirds of the row and a
              card is about 5:7. With no photo the form falls back to a full-width
              `16/10` target with a `22svh` cap, so create keeps that.
              
              CREATE HAS NO FILMSTRIP. `ItemForm` renders it only when
              `totalImages > 0`, which on create is never true, so drawing one here
              reserved a thumbnail row above fields that then jumped up. */}
          {isCreate ? (
            <div className="grid aspect-[16/10] max-h-[22svh] grid-cols-1 gap-cozy lg:contents lg:aspect-auto">
              <Skeleton className="h-full w-full rounded-lg lg:h-auto lg:min-h-[10rem] lg:flex-1" />
            </div>
          ) : (
            <div className="grid aspect-[15/14] grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-cozy lg:contents lg:aspect-auto">
              <Skeleton className="h-full w-full rounded-lg lg:h-auto lg:min-h-[10rem] lg:flex-1" />
              {/* One column of card-shaped tiles beside the cover; eight small square
                  ones from `lg`, matching the real strip's `lg:grid-cols-8`. */}
              <div className="grid h-full grid-cols-1 content-start gap-2 lg:h-auto lg:grid-cols-8 lg:content-normal">
                {Array.from({ length: 2 }, (_, index) => (
                  <Skeleton
                    key={index}
                    className="aspect-[5/7] w-full rounded-md lg:aspect-square"
                  />
                ))}
              </div>
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
            {/* `Textarea rows={4}`: four lines of `text-body` (22.4px) plus `py-2`
                and the border is 108px, at every width and on every pointer.
                RECOMPUTE THIS WHEN `body` MOVES — it was 101px at 13px, and before
                that it forked to 114px on touch, where the Textarea was floored at
                `text-lead` to stop iOS Safari zooming on focus. A stale figure here
                does not fail a test; it shifts the create-listing form on swap. */}
            <Skeleton className="h-[108px] w-full" />
            {/* The character counter's row. This was two `text-body` lines standing
                for "The first line is used as the listing title in the catalog.",
                which has been removed from `ItemForm` — all that is left under the
                textarea is `0/2000`, one `text-meta` line. */}
            <TextLines className="text-meta" widths={['w-12']} />
          </div>

          {/* `gap-3`, matching `ItemForm`. `gap-5` here added 8px between
              Category and Condition, which stack on a phone. `grid-cols-1` below
              `sm` matches the form's taxonomy row. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <TextLines className="text-body leading-none" widths={['w-20']} />
              {/* `h-9 md:h-8`, matching `SelectTrigger` — which matches `Button` and
                  `Input`, since fields and controls share one height scale. The `md`
                  height moved 28px -> 32px when `body` became 14px; a stale `md:h-7`
                  here leaves every field placeholder 4px short of the control. */}
              <Skeleton className="h-9 w-full md:h-8" />
            </div>
            <div className="space-y-2">
              <TextLines className="text-body leading-none" widths={['w-20']} />
              <Skeleton className="h-9 w-full md:h-8" />
            </div>
          </div>

          <div className="space-y-2">
            <TextLines className="text-body leading-none" widths={['w-12']} />
            {/* `MoneyInput` is an `Input` behind a currency prefix: `h-9 md:h-8`. */}
            <Skeleton className="h-9 w-full md:h-8" />
          </div>

          {/* `Based near` — a `PlacePicker`, which is a `Label` over a
              `PlaceSearch` input. The rail used to stop at the price, so it ran
              61px short of the form on every load. */}
          <div className="space-y-2">
            <TextLines className="text-body leading-none" widths={['w-24']} />
            <Skeleton className="h-9 w-full md:h-8" />
          </div>
        </div>
      </CardContent>

      {/* ONE BAR, AND THE WHOLE FOOTER IS `max-md:hidden` — both tracking `ItemForm`.
          The footer used to hold a Cancel/submit pair; Cancel is gone, and below `md`
          the submit moved into the phone chrome, so there is nothing here at all at
          that width. Two bars where the form has one is the loading state promising a
          control that never arrives.
          
          `bg-card` and `flex-col` are `ItemForm`'s too: `bg-muted` here flashed a
          tinted band to white on swap, and `flex-col-reverse` stacked the submit above
          Cancel, the reverse of where they settled. */}
      <CardFooter className="max-md:hidden flex-col items-stretch gap-2 border-t bg-card px-6 pb-4 pt-4 sm:flex-row sm:justify-end lg:col-start-2 lg:row-start-3 lg:border-l lg:border-border lg:px-7">
        {/* `h-9 md:h-8`, `Button`'s default size. */}
        <Skeleton className="h-9 w-full sm:w-32 md:h-8" />
      </CardFooter>
    </Card>
  );
}
