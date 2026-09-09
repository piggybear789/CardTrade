import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      // `text-body` unconditionally, matching Input — the same size on touch as on
      // desktop so it lines up with the surrounding UI. The old
      // `text-lead pointer-fine:text-body` floored touch at 16px to avoid iOS
      // focus-zoom; that floor has been removed and the zoom is an accepted tradeoff.
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
