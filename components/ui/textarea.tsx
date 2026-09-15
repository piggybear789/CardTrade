import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      // Keep editable text at 16px on phones to prevent iOS focus zoom. The
      // desktop body token remains 14px, matching surrounding copy.
      className={cn(
        "flex min-h-[80px] w-full scroll-mb-[calc(6rem+var(--keyboard-inset,0px))] touch-manipulation rounded-md border border-input bg-card px-3 py-2 text-base pointer-fine:text-body placeholder:text-muted-foreground focus-visible:border-iris focus-visible:outline-none disabled:cursor-not-allowed disabled:text-muted-foreground",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
