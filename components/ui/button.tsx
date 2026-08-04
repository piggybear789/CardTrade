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
const buttonVariants = cva(
  "inline-flex touch-manipulation items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold tracking-[0.01em] ring-offset-background transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:translate-y-px disabled:pointer-events-none disabled:opacity-45 disabled:active:translate-y-0 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/80",
        destructive:
          "border border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80",
        outline:
          "border border-input bg-card/80 text-foreground shadow-sm hover:border-gold/50 hover:bg-accent hover:text-accent-foreground active:bg-accent/80",
        secondary:
          "border border-border/70 bg-secondary text-secondary-foreground hover:border-gold/40 hover:bg-secondary/75 active:bg-secondary/60",
        ghost:
          "hover:bg-accent hover:text-accent-foreground active:bg-accent/80 active:text-accent-foreground",
        link: "text-foreground underline decoration-gold/55 underline-offset-4 hover:decoration-gold active:decoration-gold active:text-foreground/80",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-7",
        icon: "h-10 w-10",
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
