import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // `h-9 md:h-7`, matching Button's default size so a control and the field
          // it sits beside are the same height at every width. This used to be
          // `h-10 md:h-8` while the comment claimed the two tracked each other —
          // Button was taken down 4px in a later pass and the fields were not, so
          // every field sat 4px proud of the button next to it.
          //
          // `py-1` follows from the height: at 28px, `py-2` left a 12px content box
          // for 13px text and clipped descenders.
          //
          // `text-body` unconditionally, on touch as well as desktop, so the field
          // text matches the labels and body copy around it. We used to floor touch
          // devices at `text-lead` (16px) via `pointer-fine:text-body`, purely to
          // stop iOS Safari zooming the page on focus. That floor read as "the input
          // font is too big" next to the 13px UI, so it has been removed: fields are
          // 13px everywhere, and the iOS focus-zoom is an accepted tradeoff.
          "flex h-9 w-full scroll-mb-[calc(6rem+var(--keyboard-inset,0px))] touch-manipulation rounded-md border border-input bg-card px-3 py-1 text-body md:h-7 file:border-0 file:bg-transparent file:text-body file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-iris focus-visible:outline-none disabled:cursor-not-allowed disabled:text-muted-foreground",
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
