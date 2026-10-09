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
// SIZE: the default is 36px from `md` and 40px on touch — the marketplace
// register, where a control has to read as something to press next to large
// product photography. The 28px and 32px pointer heights this replaced read as a
// dense tool UI, and their `sm` step (24-28px) as a caption rather than a button.
//
// THE SPLIT IS THE POINT: do not collapse it. The pointer height is under a
// comfortable thumb target once you allow for the imprecision of a thumb.
//
// `Input`, `Textarea` and `SelectTrigger` track the same two heights so a control
// still lines up with the field beside it, and every skeleton that stands in for
// a control reserves these heights (`h-10 md:h-9`, `sm`: `h-9 md:h-8`).
//
// The filled variants no longer carry `shadow-sm`. It was doing nothing a
// border and a surface step were not already doing, and the palette pass gave
// cards a real lift off the page that a button does not need to compete with.
//
// FOCUS IS A RING INSIDE THE CONTROL, NOT A BORDER-COLOUR SWAP.
//
// It used to be `focus-visible:border-iris` alone. On a filled button that swaps a
// 1px `--primary` edge for a 1px `--iris` edge — same hue, 1.46:1 apart — so a
// keyboard user tabbing onto "Sign in" saw almost nothing change. Two rules now:
//
//   - QUIET variants (outline, secondary, ghost, link) turn their edge iris and add
//     a 1px inset iris ring: a 2px iris frame, 3.9:1 against the page and firmer
//     than the 3:1 `--input` edge they rest at.
//   - FILLED variants keep their edge and draw a 2px inset ring in their own LABEL
//     colour. The label colour is by construction the one that contrasts with the
//     fill (white on violet 5.3:1, brown on amber 8.9:1), so the indicator holds on
//     every fill without a per-surface tweak.
//
// A button matches `:focus-visible` from the keyboard only, so the frame never
// appears on a click.
//
// INSET, because an outset ring is clipped by any scroll container the control sits
// flush against — the reason `accordion.tsx` records for avoiding rings at all. An
// inset ring cannot be clipped by an ancestor, which removes that objection.
const buttonVariants = cva(
  // DISABLED KEEPS ITS EDGE — `disabled:border-border`, not `disabled:border-muted`.
  //
  // The disabled fill is `--muted` (283 34% 96%), a violet-tinted near-white, and the
  // border matched it. On a white card that reads as a flat slab, which is what it was
  // designed against. On any TINTED surface it disappears completely: the contract
  // room's status card is `bg-iris/[0.08]`, which lands at roughly the same lightness
  // in the same hue family, so "Record shipment" had no fill and no edge — the label
  // floated in the card with nothing around it and read as a caption rather than a
  // control that was waiting on the two fields above it.
  //
  // `--input` is the edge every control uses (fields, outline, secondary), so a
  // disabled control keeps the same edge as its enabled neighbours and holds its
  // shape on whatever surface it sits on. The fill stays
  // as it was: with an edge, it no longer has to carry the shape by itself.
  //
  // Do NOT fix this by tinting the fill per surface. The fill is one token and the
  // surfaces are many; the edge is what makes it surface-independent.
  "inline-flex touch-manipulation items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent text-body font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-inset active:translate-y-px disabled:pointer-events-none disabled:border-input disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none disabled:active:translate-y-0 [&_svg]:pointer-events-none [&_svg]:block [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border border-primary bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 focus-visible:ring-2 focus-visible:ring-primary-foreground",
        // Obsidian, for a committing control that sits beside a destructive
        // one. Purple and red are two saturated hues arguing at the same
        // weight; black reads as "the thing to do" and lets the red mean
        // danger on its own.
        contrast:
          "border border-obsidian bg-obsidian text-white hover:bg-obsidian/90 active:bg-obsidian/80 focus-visible:ring-2 focus-visible:ring-white",
        // ONE FILLED CTA COLOUR. `action` was a pastel amber fill; under the
        // monochrome palette it renders exactly as `default` (ink), so the buy
        // bar and the room's "your move" control read as the primary rather than
        // as a second, louder brand. Kept as a variant name so call sites can still
        // say what the control MEANS. Amber survives as a signal (`--action`), not
        // a button.
        action:
          "border border-primary bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 focus-visible:ring-2 focus-visible:ring-primary-foreground",
        success:
          "border border-trust bg-trust text-white hover:bg-trust/90 active:bg-trust/80 focus-visible:ring-2 focus-visible:ring-white",
        destructive:
          "border border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80 focus-visible:ring-2 focus-visible:ring-destructive-foreground",
        // `hover:border-foreground/60`, not a violet edge. These two are the
        // QUIET variants — the ones used where `default` would be too loud — and
        // turning their border violet on hover put them back in the primary's
        // colour at the exact moment the pointer was on them. The hover state is
        // carried by the fill (`bg-accent` / `bg-secondary/75`); the edge only has
        // to firm up, which means going DARKER than the 3:1 `--input` it rests at.
        outline:
          "border border-input bg-card text-foreground hover:border-foreground/60 hover:bg-accent hover:text-accent-foreground active:bg-accent/80 focus-visible:border-iris focus-visible:ring-1 focus-visible:ring-iris",
        secondary:
          "border border-input bg-secondary text-secondary-foreground hover:border-foreground/60 hover:bg-secondary/75 active:bg-secondary/60 focus-visible:border-iris focus-visible:ring-1 focus-visible:ring-iris",
        ghost:
          "hover:bg-accent hover:text-accent-foreground active:bg-accent/80 active:text-accent-foreground focus-visible:border-iris focus-visible:ring-1 focus-visible:ring-iris",
        link: "text-foreground underline decoration-iris/55 underline-offset-4 hover:decoration-iris active:decoration-iris active:text-foreground/80 focus-visible:border-iris focus-visible:ring-1 focus-visible:ring-iris",
      },
      size: {
        // 40px on touch, 36px from `md`. The content box has to hold a 14px line
        // at 1.6 (22.4px) with air above and below it, or the label reads as
        // cramped however it is set; if the type scale moves, re-derive these.
        //
        // `lg` (44/40px) is the only size that should ever be the biggest thing
        // on a screen.
        default: "h-10 px-group md:h-9",
        sm: "h-9 rounded-md px-cozy md:h-8",
        // `sm`'s heights with `meta` type. For a control that sits INSIDE dense
        // chrome — a composer footer, a card corner, a toolbar — where every
        // neighbour is 12px and a 14px label is the loudest thing in the box. Not
        // for a form's primary action on a page, where `body` matches the copy
        // around it. `meta` is normally chrome-only; this is the one control
        // register allowed to wear it, because here the button IS chrome.
        xs: "h-8 rounded-md px-snug text-meta md:h-7 [&_svg]:size-3",
        lg: "h-11 rounded-md px-5 md:h-10",
        icon: "size-9 md:size-8",
        // 44px on touch, 36px from `md`. For the one place an icon control is the
        // primary action on a screen — a chat composer's send/attach pair — and
        // must sit level with the composer field beside it (`min-h-11 md:min-h-9`),
        // so the two move together. Do not reach for it in toolbars or card corners.
        "icon-lg": "size-11 md:size-9",
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
