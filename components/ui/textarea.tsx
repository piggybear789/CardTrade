import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      // `text-body`, matching `Input` and the copy around it. This carried
      // `text-base pointer-fine:text-body` and the same stale-variant problem — see
      // the note in `components/ui/input.tsx`: the variant no longer exists, so the
      // step-down emitted nothing and every textarea sat at 16px.
      className={cn(
        "flex min-h-[80px] w-full scroll-mb-[calc(6rem+var(--keyboard-inset,0px))] touch-manipulation rounded-md border border-input bg-card px-3 py-2 text-body placeholder:text-muted-foreground focus-visible:border-iris focus-visible:outline-none disabled:cursor-not-allowed disabled:text-muted-foreground",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
