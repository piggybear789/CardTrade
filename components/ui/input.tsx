import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Focus and invalid states shared by every field primitive. `Textarea` and
 * `SelectTrigger` import this rather than restating it, so the three cannot drift.
 *
 * FOCUS is the edge turning full iris plus a soft 3px halo. The edge carries the
 * contrast (3.85:1 against a card, above the 3:1 resting `--input`, so focus always
 * reads as firmer than rest); the halo carries the recognisability at a glance. A
 * text field matches `:focus-visible` on a mouse click as well, so the halo is kept
 * faint rather than a heavy frame. Where an ancestor clips it, the edge still holds.
 *
 * INVALID reads `aria-invalid`, which `FormControl` and the hand-rolled forms already
 * set and nothing styled, so only the label ever turned red. Invalid-and-focused stays
 * red rather than going iris: tabbing back into a field must not hide its error.
 */
export const fieldStateClasses =
  "focus-visible:border-iris focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-iris/20 aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:border-destructive aria-[invalid=true]:focus-visible:ring-destructive/20";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // `h-10 md:h-9`, matching Button's default size so a control and the field
          // it sits beside are the same height at every width. The two must move
          // together: a field left behind when Button changed once sat 4px proud of
          // every button beside it.
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
          "flex h-10 w-full scroll-mb-[calc(6rem+var(--keyboard-inset,0px))] touch-manipulation rounded-md border border-input bg-card px-cozy py-tight text-body md:h-9 file:border-0 file:bg-transparent file:text-body file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:text-muted-foreground",
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
