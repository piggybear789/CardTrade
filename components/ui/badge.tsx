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
//
// ONE RECIPE, THREE TONES OF ONE HUE: a pale fill, an edge a step darker than the
// fill, and the label in the hue's ink. It is the status badge Stripe and Clerk share
// (Mobbin, 2026-11-21), and it replaced SOLID violet and SOLID red chips. Those were
// the loudest objects on a contract list, louder than the buttons, and "In transit"
// shouted exactly as hard as "Disputed". Every tone is now the same weight and the
// states differ by hue alone, which is what lets a column of forty be scanned.
//
// THE HUES MEAN ONE THING EACH, the same as everywhere else in the palette:
//   iris (default)  live, in progress
//   trust           settled, verified, done
//   warning         waiting on someone; needs attention but is not wrong
//   destructive     disputed, failed, at risk
//   secondary/muted neutral: not started, closed, cancelled
// `solid` is the one filled chip, for a COUNT that has to be found (unread messages).
//
// GEOMETRY IS FIXED, not derived from padding: `min-h` with `leading-none`, so a badge
// is the same height whether it holds a word, a number or an icon. The height is
// 1.425rem (22.8px) because that is what the old padding produced, and the skeletons
// (`BadgeSkeleton`, `WorkspaceSkeletons`, the listing loader) and the chat bar's row
// floor were all measured against it. `min-h` rather than `h` so a long label in a
// narrow column still wraps instead of spilling out of its edge. An icon inside takes
// 12px and the gap; a leading 6px dot can be passed as a child.
const badgeVariants = cva(
  "inline-flex min-h-[1.425rem] items-center gap-1 rounded-md border px-2 text-meta font-medium leading-none [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-iris/30 bg-iris/[0.08] text-iris-ink",
        // Neutral GREY, not the lavender `--secondary` fill. With live states now a
        // violet tint, a lavender "Negotiating" sat one shade away from a violet
        // "In transit" and the two read as the same state.
        secondary: "border-border bg-muted text-muted-foreground",
        destructive: "border-destructive/30 bg-destructive/[0.07] text-destructive",
        // `--trust` as text on this tint is the pairing `scripts/palette-contrast.mjs`
        // checks as "text-trust on muted".
        trust: "border-trust/30 bg-trust/[0.08] text-trust",
        // The amber "your move" signal as a badge. Label in `action-foreground` (dark
        // brown), never amber: amber text on an amber tint does not reach 4.5:1.
        warning: "border-action-edge/35 bg-action/30 text-action-foreground",
        // Aliases kept so existing status maps compile. They render as their twins.
        iris: "border-iris/30 bg-iris/[0.08] text-iris-ink",
        "destructive-soft": "border-destructive/30 bg-destructive/[0.07] text-destructive",
        muted: "border-border bg-muted text-muted-foreground",
        outline: "border-border bg-card text-foreground",
        solid: "border-primary bg-primary text-primary-foreground",
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
