import * as React from "react";

import { cn } from "@/lib/utils";

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
          // `py-1` follows from the height: at 28px, `py-2` left a 12px content box
          // and clipped descenders.
          //
          // `md:h-8` (32px), RAISED FROM 28px, and the note that used to sit here
          // predicted exactly why. At 28px the content box was 18px — the border and
          // `py-1` taking 10px — against a 22.4px line box once `body` became 14px.
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
          // If iOS focus-zoom ever has to be suppressed again, the gate is
          // `@supports (-webkit-touch-callout: none)` and not a pointer query — see
          // the reasoning kept in tailwind.config.ts.
          "flex h-9 w-full scroll-mb-[calc(6rem+var(--keyboard-inset,0px))] touch-manipulation rounded-md border border-input bg-card px-3 py-1 text-body md:h-8 file:border-0 file:bg-transparent file:text-body file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-iris focus-visible:outline-none disabled:cursor-not-allowed disabled:text-muted-foreground",
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
