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
// A SOFT TINT AND NOTHING ELSE (2026-11-28, design-system audit). The recipe this
// replaced was three tones of one hue: a pale fill, an edge a step darker, and the
// label in the hue's ink. The edge is what made a column of them read as a stack of
// outlined chips, and on the neutral tone, a grey box with a grey border and grey
// text, it read as a DISABLED control. Linear, Stripe and Vercel all draw a status as
// a borderless tint; the tint alone separates it from the row, and a status that needs
// more weight takes the DOT (`dot`), not a heavier box.
//
// THE HUES MEAN ONE THING EACH, the same as everywhere else in the palette:
//   iris (default)  live, in progress
//   trust           settled, verified, done
//   warning         waiting on someone; needs attention but is not wrong
//   destructive     disputed, failed, at risk
//   secondary/muted neutral: not started, closed, cancelled
//   outline         a fact rather than a state ("No contract"): a hairline, no fill
// `solid` is the one filled chip, for a COUNT that has to be found (unread messages).
//
// `dot` puts a 6px mark in the label's own colour before the text. Contract statuses
// carry it (`ContractStatusBadge`), so a status reads as a state at a glance and a
// neutral one still looks deliberate; plain labels ("Proof", "In review") do not.
//
// GEOMETRY IS FIXED: 20px (`min-h-5`) with `leading-none`, so a badge is the same
// height whether it holds a word, a number or an icon. It came down from 22.8px with
// the border: the height was the old padding plus a 1px edge on each side, and the
// chat bar's row floor (`threadGeometry`) is re-derived against the new figure.
// `min-h` rather than `h` so a long label in a narrow column still wraps instead of
// spilling out. An icon inside takes 12px and the gap.
const badgeVariants = cva(
  "inline-flex min-h-5 items-center gap-1 rounded-md px-1.5 text-meta font-medium leading-none [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // 12% iris under iris-ink text: 6.7:1.
        default: "bg-iris/[0.12] text-iris-ink",
        // A tint of the INK, not the slate `--muted` fill, so it darkens whatever it
        // sits on (a white row, the slate rail, a tinted card) by the same step.
        secondary: "bg-foreground/[0.06] text-foreground/75",
        // 8% red under destructive text: 4.9:1.
        destructive: "bg-destructive/[0.08] text-destructive",
        // `--trust` on its 8% tint is the pairing `scripts/palette-contrast.mjs` checks
        // as "text-trust on muted" (4.6:1).
        trust: "bg-trust/[0.08] text-trust",
        // The amber "your move" signal as a badge. Label in `action-foreground` (dark
        // brown), never amber: amber text on an amber tint does not reach 4.5:1.
        warning: "bg-action/40 text-action-foreground",
        // Aliases kept so existing status maps compile. They render as their twins.
        iris: "bg-iris/[0.12] text-iris-ink",
        "destructive-soft": "bg-destructive/[0.08] text-destructive",
        muted: "bg-foreground/[0.06] text-foreground/75",
        // The hairline is an inset shadow, not a border, so it adds no height.
        outline: "bg-card text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))]",
        solid: "bg-primary text-primary-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** A 6px mark in the label's colour before the text. For a contract STATUS. */
  dot?: boolean;
}

function Badge({ className, variant, dot = false, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot ? (
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      ) : null}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
