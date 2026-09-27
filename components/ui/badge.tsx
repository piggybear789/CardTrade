import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// A STATUS LABEL, NOT A CONTROL. No `hover:` states: every badge in the app is
// static, and a chip that darkens under the pointer invites a click that does
// nothing. Anything interactive that looks like this belongs in a <button>.
//
// Rendered as a <span> so it is valid inside a <p> or a heading. As a <div> it was
// flow content in phrasing context, which React reports as a hydration error the
// first time a badge is dropped into a sentence.
const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-meta font-medium",
  {
    variants: {
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground",
        secondary:
          "border-border bg-secondary text-secondary-foreground",
        destructive:
          "border-destructive bg-destructive text-destructive-foreground",
        // SETTLED, and the reason a fifth variant exists at all.
        //
        // `default` was carrying six cash-sale statuses and four trade states, so
        // "In transit" and "Completed" rendered as the same solid violet chip — the
        // colour told a member the contract was live and nothing more, which on a
        // surface listing forty contracts is the difference between scanning and
        // reading. Teal already means verified and settled everywhere else in the
        // palette, so a finished contract belongs to it.
        //
        // Tinted rather than solid: a completed contract is the calm outcome and does
        // not need the weight of a filled chip. `--trust` as text on this tint is the
        // pairing `scripts/palette-contrast.mjs` checks as "text-trust on muted".
        trust:
          "border-[hsl(var(--trust)/0.4)] bg-[hsl(var(--trust)/0.1)] text-trust",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
