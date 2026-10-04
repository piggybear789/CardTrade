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
    <Card className="mx-auto w-full min-w-0 max-w-7xl max-lg:overflow-x-clip lg:overflow-clip lg:grid lg:h-[calc(100dvh-8.25rem-var(--keyboard-inset,0px))] lg:min-h-[34rem] lg:grid-cols-[minmax(0,1.65fr)_minmax(min(340px,40%),0.95fr)] lg:grid-rows-[auto_1fr_auto]">
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
        <TextLines className="text-subhead" widths={['w-1/2']} />
        <TextLines className="hidden text-body md:block" widths={['w-full']} />
      </CardHeader>

      {/* `gap-5`, matching `ItemForm`'s `CardContent`. `gap-section` put 12px of extra
          air between the photo panel and the details rail on every phone.
          `grid-cols-1` also matches `ItemForm`: it pins the stacked mobile column
          to `minmax(0, 1fr)` so it tracks the card's width rather than its
          content, keeping the placeholder the same width as the form it stands in
          for. */}
      {/* `max-md:pt-group` in create mode, matching `ItemForm`: with the header hidden
          below `md`, the form restores the top padding `CardHeader` would otherwise
          supply. Without it here the whole phone placeholder sat 16px high. */}
      <CardContent
        className={cn('grid grid-cols-1 gap-5 lg:contents', isCreate && 'max-md:pt-group')}
      >
        {/* Photos panel */}
        {/* `lg:bg-card` and the cover's aspect ratio both mirror ItemForm: the
            panel used to paint `lg:bg-muted`, so it visibly changed colour on
            swap, and the cover was `aspect-square` against the form's
            `aspect-[16/10] max-h-[22svh]` — a large jump on phones. */}
        {/* `flex flex-col gap-*`, matching the form's column — it moved off `space-y`
            and onto `gap`, and to `group` (16px) at `lg`. A 12px rhythm here against a
            16px one there shifts every element below the label on swap.
            `lg:min-h-0 lg:overflow-hidden` are the form's too: they are what let the
            photo row below take the panel's remainder rather than its content height. */}
        <div className="flex flex-col gap-cozy lg:col-start-1 lg:row-span-3 lg:row-start-1 lg:min-h-0 lg:gap-group lg:overflow-hidden lg:bg-card lg:p-section">
          {/* The `Photos` label, a 14px `leading-none` `Label`. It was `h-4`, which
              is 16px against a 14px line.
              
              ONE LINE, NOT TWO. A second `w-48` bar stood for the "Add 1–10 photos.
              N selected." paragraph under the label; that line was removed from
              `ItemForm`, so reserving 22.4px for it here would drop the whole panel
              on swap. */}
          <TextLines className="text-body leading-none" widths={['w-1/3']} />

          {/* ONE LAYOUT AT EVERY WIDTH, as `ItemForm` now draws it: the cover in the
              left two thirds and the other photos stacked down the right third, two to
              the column, each exactly half its height.

              THE ROW OWNS THE HEIGHT. Below `lg` it is an aspect ratio — `15/14` once
              there is a photo, a full-width `16/10` capped at `22svh` with none — and
              from `lg` it is the flex child that takes the panel's remainder
              (`lg:flex-1 lg:min-h-0 lg:aspect-auto`). `grid-rows-[minmax(0,1fr)]` hands
              that height to both cells.

              This placeholder used to dissolve the row with `lg:contents` and draw an
              eight-up strip of squares UNDER the cover — the form's previous desktop
              layout — so on every desktop edit the cover shrank and the thumbnails
              jumped from beneath it to beside it on swap.

              CREATE HAS NO FILMSTRIP. `ItemForm` renders it only when
              `totalImages > 0`, which on create is never true. */}
          {isCreate ? (
            <div className="grid aspect-[16/10] max-h-[22svh] grid-cols-1 grid-rows-[minmax(0,1fr)] gap-cozy lg:aspect-auto lg:max-h-none lg:min-h-0 lg:flex-1">
              <Skeleton className="h-full min-h-0 w-full rounded-lg" />
            </div>
          ) : (
            <div className="grid aspect-[15/14] grid-cols-[minmax(0,2fr)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-cozy lg:aspect-auto lg:max-h-none lg:min-h-0 lg:flex-1">
              <Skeleton className="h-full min-h-0 w-full rounded-lg" />
              {/* `auto-rows-[calc(50%_-_0.25rem)]`, the real strip's: two tiles fill
                  the column edge to edge whatever its height. */}
              <div className="grid h-full min-h-0 auto-rows-[calc(50%_-_0.25rem)] grid-cols-1 content-start gap-snug overflow-hidden">
                {Array.from({ length: 2 }, (_, index) => (
                  <Skeleton key={index} className="min-h-0 w-full rounded-md" />
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
          <div className="space-y-snug">
            {/* `mb-snug` is the real `<legend>`'s own margin. A rendered legend sits
                outside the fieldset's content box, so its margin does NOT collapse
                with the tile grid's `space-y` margin — the gap is 16px, not 8. Padding
                here, not margin, because between two plain divs it WOULD collapse. */}
            <TextLines className="pb-snug text-body leading-none" widths={['w-1/2']} />
            <div className="grid grid-cols-2 gap-snug">
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
                fieldset, so it sits at the block's own `space-y-snug` rather than the
                rail's `space-y-5`. Edit mode only. Width is canonical texture. */}
            {isCreate ? null : <TextLines className="text-body" widths={['w-2/3']} />}
          </div>

          <div className="space-y-snug">
            <TextLines className="text-body leading-none" widths={['w-1/3']} />
            {/* `Textarea rows={4}`: four lines of `text-body` (22.4px) plus `py-snug`
                and the border is 108px, at every width and on every pointer.
                RECOMPUTE THIS WHEN `body` MOVES — it was 101px at 13px, and before
                that it forked to 114px on touch, where the Textarea was floored at
                `text-lead` to stop iOS Safari zooming on focus. A stale figure here
                does not fail a test; it shifts the create-listing form on swap. */}
            <Skeleton className="h-[108px] w-full" />
            {/* The character counter's row. This was two `text-body` lines standing
                for "The first line is used as the listing title in the catalog.",
                which has been removed from `ItemForm` — all that is left under the
                textarea is `0/2000`, one `text-meta` line. Width is canonical texture. */}
            <TextLines className="text-meta" widths={['w-1/3']} />
          </div>

          {/* `gap-cozy`, matching `ItemForm`. `gap-5` here added 8px between
              Category and Condition, which stack on a phone. `grid-cols-1` below
              `sm` matches the form's taxonomy row. */}
          <div className="grid grid-cols-1 gap-cozy sm:grid-cols-2">
            <div className="space-y-snug">
              <TextLines className="text-body leading-none" widths={['w-1/3']} />
              {/* `h-9 md:h-8`, matching `SelectTrigger` — which matches `Button` and
                  `Input`, since fields and controls share one height scale. The `md`
                  height moved 28px -> 32px when `body` became 14px; a stale `md:h-7`
                  here leaves every field placeholder 4px short of the control. */}
              <Skeleton className="h-9 w-full md:h-8" />
            </div>
            <div className="space-y-snug">
              <TextLines className="text-body leading-none" widths={['w-1/3']} />
              <Skeleton className="h-9 w-full md:h-8" />
            </div>
          </div>

          <div className="space-y-snug">
            <TextLines className="text-body leading-none" widths={['w-1/3']} />
            {/* `MoneyInput` is an `Input` behind a currency prefix: `h-9 md:h-8`. */}
            <Skeleton className="h-9 w-full md:h-8" />
          </div>

          {/* `Based near` — a `PlacePicker`, which is a `Label` over a
              `PlaceSearch` input. The rail used to stop at the price, so it ran
              61px short of the form on every load. Label width is canonical texture. */}
          <div className="space-y-snug">
            <TextLines className="text-body leading-none" widths={['w-1/3']} />
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
      <CardFooter className="max-md:hidden flex-col items-stretch gap-snug border-t bg-card px-6 pb-group pt-group sm:flex-row sm:justify-end lg:col-start-2 lg:row-start-3 lg:border-l lg:border-border lg:px-7">
        {/* `h-9 md:h-8`, `Button`'s default size. */}
        <Skeleton className="h-9 w-full sm:w-32 md:h-8" />
      </CardFooter>
    </Card>
  );
}
