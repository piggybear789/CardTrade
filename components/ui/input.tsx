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
          // `text-body` unconditionally, on touch as well as desktop, so the field
          // text matches the labels and body copy around it. We used to floor touch
          // devices at `text-lead` (16px) via `pointer-fine:text-body`, purely to
          // stop iOS Safari zooming the page on focus. That floor read as "the input
          // font is too big" next to the surrounding UI, so it has been removed:
          // fields are `body` everywhere, and the iOS focus-zoom is an accepted
          // tradeoff. 14px does not avoid the zoom — the threshold is 16px.
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
