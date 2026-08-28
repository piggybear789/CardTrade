import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // `h-10 md:h-8`, tracking Button's default size so a control and the
          // field it sits beside are the same height at every width.
          //
          // `text-lead` on phones is the iOS zoom floor, not a type choice — see
          // the note on `lead` in the Tailwind type scale. `sm:text-body` is where
          // the density arrives.
          "flex h-10 w-full scroll-mb-[calc(6rem+var(--keyboard-inset,0px))] touch-manipulation rounded-md border border-input bg-card px-3 py-2 text-lead md:h-8 sm:text-body file:border-0 file:bg-transparent file:text-body file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-iris focus-visible:outline-none disabled:cursor-not-allowed disabled:text-muted-foreground",
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
