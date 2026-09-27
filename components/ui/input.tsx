import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Focus and invalid states shared by every field primitive. `Textarea` and
 * `SelectTrigger` import this rather than restating it, so the three cannot drift.
 *
 * FOCUS is the edge turning iris PLUS a 1px inset iris ring: a 2px frame. The edge
 * alone was a 1px hue shift from `--input` to `--iris`, which sit 1.17:1 apart in
 * luminance — findable if you were looking for it, easy to lose on a long form. Inset
 * so a field flush against a scroll container's edge cannot have it clipped.
 *
 * INVALID reads `aria-invalid`, which `FormControl` and the hand-rolled forms already
 * set and nothing styled, so only the label ever turned red. Invalid-and-focused stays
 * red rather than going iris: tabbing back into a field must not hide its error.
 */
export const fieldStateClasses =
  "focus-visible:border-iris focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-iris aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:border-destructive aria-[invalid=true]:focus-visible:ring-destructive";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // `h-9 md:h-8`, matching Button's default size so a control and the field
          // it sits beside are the same height at every width. This used to be
          // `h-10 md:h-8` while the comment claimed the two tracked each other —
          // Button was taken down 4px in a later pass and the fields were not, so
          // every field sat 4px proud of the button next to it.
          //
          // `py-tight` follows from the height: at 28px, `py-snug` left a 12px content box
          // and clipped descenders.
          //
          // `md:h-8` (32px), RAISED FROM 28px, and the note that used to sit here
          // predicted exactly why. At 28px the content box was 18px — the border and
          // `py-tight` taking 10px — against a 22.4px line box once `body` became 14px.
          // The text was bigger than the box around it, so the field looked cramped
          // however the type was set. 32px leaves 22px and the line fits.
          //
          // Button moved with it, because these two must stay equal.
          //
          // `text-body` (14px), FULL STOP — the same token as the label above the
          // field and the copy beside it.
          //
          // This read `text-base pointer-fine:text-body`, which was correct when the
          // `pointer-fine:` variant existed: 16px by default so iOS Safari would not
          // focus-zoom, stepping down to the body token on a device with a precise
          // pointer. That variant was REMOVED from tailwind.config.ts — its own note
          // says "fields are `body` everywhere now, so the variant had no call sites
          // left" — but this class string was never updated. An unknown variant emits
          // nothing, so the step-down silently stopped applying and every field in the
          // product went back to 16px while its label stayed at 14px. That is the
          // mismatch you can see on any form: the value is visibly larger than the
          // name of the field holding it.
          //
          // THE iOS FOCUS-ZOOM IS SUPPRESSED, in globals.css rather than here. iOS
          // Safari still zooms a focused field under 16px and never zooms back out, so
          // the floor is a rule behind `@supports (-webkit-touch-callout: none)` — iOS
          // only, not a pointer or width query (see tailwind.config.ts) — that lifts
          // `meta`/`body`-sized and inherited fields to 16px. This list stays
          // `text-body`; an iPhone renders the value 2px larger than its label, which
          // is the price of not zooming.
          "flex h-9 w-full scroll-mb-[calc(6rem+var(--keyboard-inset,0px))] touch-manipulation rounded-md border border-input bg-card px-cozy py-tight text-body md:h-8 file:border-0 file:bg-transparent file:text-body file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:text-muted-foreground",
          fieldStateClasses,
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
