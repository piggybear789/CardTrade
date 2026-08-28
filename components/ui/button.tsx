"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Every button in the app routes through this cva, so a missing state here is a
// missing state everywhere. `active:` was absent entirely: on a slow navigation a
// user clicked and saw nothing change until the next page arrived, and the usual
// reaction to that is a second click. `ghost` was worst affected — its resting
// state has no background, so there was no feedback of any kind.
//
// `transition-colors` covers the background shift; the 1px nudge is instant, which
// is what makes it read as a press. Both are neutralised by the global
// `prefers-reduced-motion` block in `globals.css`.
// TYPOGRAPHY: `font-medium`, and NO letter-spacing of its own.
//
// This was `font-semibold tracking-[0.01em]`, which made the button the only
// element in `components/ui` with POSITIVE letter-spacing — body copy is
// `-0.01em` from the root and every heading is `tracking-tight`. So a label was
// set about 0.02em looser than every other word on the page, at a weight
// otherwise reserved for 16–18px headings, while the `Badge` sitting beside it
// was `font-medium`. That is what made buttons read as imported from a
// different system rather than as part of this one.
//
// SIZE: the default is `h-8` (32px) from `md`, down from 36px, with the
// horizontal padding tightened to match. Against a 13px body and a spacing scale
// that stops at 16px, a 36px pill with 16px of side padding read inflated — the
// label occupied about half the control.
//
// PHONES GET 36px, desktop 28px. 44 is Apple's recommendation rather than a
// floor; the conformance requirement is WCAG 2.2 SC 2.5.8, which asks for 24x24
// CSS pixels, and 36 clears that with half again to spare. What the reduction
// buys is a phone that does not look like a tablet UI scaled down — a stack of
// 44px bars against a 13px body was the loudest thing on every mobile screen.
//
// THE SPLIT IS THE POINT: do not collapse it. 28px is a pointer target and is
// under the floor once you allow for the imprecision of a thumb.
//
// `Input`, `Textarea` and `SelectTrigger` track the same two heights so a control
// still lines up with the field beside it.
//
// The filled variants no longer carry `shadow-sm`. It was doing nothing a
// border and a surface step were not already doing, and the palette pass gave
// cards a real lift off the page that a button does not need to compete with.
const buttonVariants = cva(
  "inline-flex touch-manipulation items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent text-body font-medium transition-colors duration-150 focus-visible:border-iris focus-visible:outline-none active:translate-y-px disabled:pointer-events-none disabled:border-muted disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none disabled:active:translate-y-0 [&_svg]:pointer-events-none [&_svg]:block [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border border-primary bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80",
        // Obsidian, for a committing control that sits beside a destructive
        // one. Purple and red are two saturated hues arguing at the same
        // weight; black reads as "the thing to do" and lets the red mean
        // danger on its own.
        contrast:
          "border border-obsidian bg-obsidian text-white hover:bg-obsidian/90 active:bg-obsidian/80",
        // `border-action-edge`, not `border-obsidian/10`. The fill is a pastel
        // now and sits 1.55:1 against a white page, so a 10%-alpha edge left the
        // control with no boundary meeting SC 1.4.11. See `--action-border`.
        action:
          "border border-action-edge bg-action text-action-foreground hover:bg-[color-mix(in_oklch,hsl(var(--action)),hsl(var(--obsidian))_12%)] active:bg-[color-mix(in_oklch,hsl(var(--action)),hsl(var(--obsidian))_20%)]",
        success:
          "border border-trust bg-trust text-white hover:bg-trust/90 active:bg-trust/80",
        destructive:
          "border border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80",
        outline:
          "border border-border bg-card/80 text-foreground hover:border-iris/50 hover:bg-accent hover:text-accent-foreground active:bg-accent/80",
        secondary:
          "border border-border bg-secondary text-secondary-foreground hover:border-iris/50 hover:bg-secondary/75 active:bg-secondary/60",
        ghost:
          "hover:bg-accent hover:text-accent-foreground active:bg-accent/80 active:text-accent-foreground",
        link: "text-foreground underline decoration-iris/55 underline-offset-4 hover:decoration-iris active:decoration-iris active:text-foreground/80",
      },
      size: {
        // 36px on touch, 28px from `md`, with the side padding pulled in to
        // match. A label needs about as much room to its left and right as the
        // cap height either side of it; more than that and the control reads as
        // a slab with a word floating in it.
        //
        // `lg` is the exception at 40px, and it is the only size that should
        // ever be the biggest thing on a screen.
        default: "h-9 px-3 py-1.5 md:h-7 md:px-2.5",
        sm: "h-8 rounded-md px-2.5 md:h-6 md:px-2",
        lg: "h-10 rounded-md px-5 md:h-9",
        icon: "size-8 md:size-7",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
