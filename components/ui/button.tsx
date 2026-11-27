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
// What they carry now is a 1-2px edge treatment, not a bloom; see TONAL, NOT EDGED.
//
// FOCUS IS A RING INSIDE THE CONTROL, NOT A BORDER-COLOUR SWAP.
//
// It used to be a border-colour swap alone. On a filled button that swaps a 1px
// `--primary` edge for a 1px `--iris` edge — the same hue — so a keyboard user
// tabbing onto "Sign in" saw almost nothing change. Two rules now:
//
//   - QUIET variants (secondary and its `outline` alias, the soft and quiet
//     destructive ones, ghost) draw a 2px inset graphite frame (`--ring`), far firmer
//     than the tint they rest on. `link` keeps its 1px frame on the transparent edge.
//   - FILLED variants keep their edge and draw a 2px inset ring in their own LABEL
//     colour. The label colour is by construction the one that contrasts with the
//     fill (white on ink 17:1, white on red 6:1), so the indicator holds on
//     every fill without a per-surface tweak.
//
// A button matches `:focus-visible` from the keyboard only, so the frame never
// appears on a click.
//
// INSET, because an outset ring is clipped by any scroll container the control sits
// flush against — the reason `accordion.tsx` records for avoiding rings at all. An
// inset ring cannot be clipped by an ancestor, which removes that objection.
//
// DISABLED, TWO WAYS, by register.
//
// A FILLED variant keeps its own fill at half strength. It is the action a form or
// dialog is working towards, and greyed out it read as one more outline button, so the
// main action vanished until it was ready. A half-strength fill still says which
// control it will be, and holds its shape on a tinted surface because the fill is
// its own colour, not a surface token.
//
// A QUIET variant goes to a fainter tint of the ink with a muted label. The tint is an
// ALPHA of the foreground, so it darkens whatever is under it and a disabled control
// keeps its shape on every surface — the contract room's status card is
// `bg-iris/[0.08]`, at roughly the lightness `--muted` would have been, and a muted
// slab vanished on it. Do NOT fix that by tinting the fill per surface: the fill is one
// token and the surfaces are many.
//
// TONAL, NOT EDGED (2026-11-28, design-system audit; Instagram, Apple, Airbnb on Mobbin).
//
// Quiet variants rested on `border-input`, the control edge, with a 1px drop: the
// bordered-white secondary Stripe and Clerk use, and the stock shadcn button. Beside
// borderless badges and the pill composer it was the last object on each screen that
// still read as a template, so every quiet variant is now a tint of the ink with no
// edge and no drop (`TONAL` below). Fields keep `border-input`: a field is a place to
// type, and its edge is what says so; a button is a thing to press, and its fill is.
//
// FILLED variants get a 1px inner top highlight and a hairline drop shadow: the fill
// reads as a pressable surface rather than a flat swatch. Not the old `shadow-sm` bloom,
// which was removed for good reason; both layers here are 1-2px. The focus ring still
// draws, because Tailwind composes `ring` and `shadow` into one `box-shadow`.
const FILLED_DEPTH = "shadow-[inset_0_1px_0_hsl(0_0%_100%/0.16),0_1px_2px_hsl(var(--obsidian)/0.14)]";
const FILLED_DISABLED = "disabled:opacity-50";
const QUIET_DISABLED = "disabled:border-input disabled:bg-muted disabled:text-muted-foreground";
// THE TONAL RECIPE every quiet variant shares since 2026-11-28: a tint of the ink, no
// edge, no drop. Focus is the 2px inset `--ring` frame the filled variants draw (in their
// label colour); disabled is a fainter tint with a muted label, which stays visible on any
// surface because the tint darkens whatever is under it.
const TONAL = "bg-foreground/[0.06]";
const TONAL_FOCUS = "focus-visible:ring-2 focus-visible:ring-ring";
const TONAL_DISABLED = "disabled:bg-foreground/[0.04] disabled:text-muted-foreground";

const buttonVariants = cva(
  "inline-flex touch-manipulation items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent text-body font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-inset active:translate-y-px disabled:pointer-events-none disabled:shadow-none disabled:active:translate-y-0 [&_svg]:pointer-events-none [&_svg]:block [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: `border border-primary bg-primary text-primary-foreground ${FILLED_DEPTH} hover:bg-primary/90 active:bg-primary/80 focus-visible:ring-2 focus-visible:ring-primary-foreground ${FILLED_DISABLED}`,
        // Obsidian, for a committing control that sits beside a destructive
        // one: black reads as "the thing to do" and lets the red mean danger on
        // its own. Since the primary became ink this is a shade darker than
        // `default` and nothing more; kept so call sites still say what they mean.
        contrast: `border border-obsidian bg-obsidian text-white ${FILLED_DEPTH} hover:bg-obsidian/90 active:bg-obsidian/80 focus-visible:ring-2 focus-visible:ring-white ${FILLED_DISABLED}`,
        // ONE FILLED CTA COLOUR. `action` was a pastel amber fill; under the
        // monochrome palette it renders exactly as `default` (ink), so the buy
        // bar and the room's "your move" control read as the primary rather than
        // as a second, louder brand. Kept as a variant name so call sites can still
        // say what the control MEANS. Amber survives as a signal (`--action`), not
        // a button.
        action: `border border-primary bg-primary text-primary-foreground ${FILLED_DEPTH} hover:bg-primary/90 active:bg-primary/80 focus-visible:ring-2 focus-visible:ring-primary-foreground ${FILLED_DISABLED}`,
        success: `border border-trust bg-trust text-white ${FILLED_DEPTH} hover:bg-trust/90 active:bg-trust/80 focus-visible:ring-2 focus-visible:ring-white ${FILLED_DISABLED}`,
        // FILLED RED IS FOR THE CONFIRMATION, NOT THE TRIGGER. A button that only opens
        // "Delete listing?" or "Report this user" was the loudest control on its
        // screen, louder than the action the member came to take. Triggers use
        // `destructive-quiet`: the tonal shape with a red label, so danger still reads,
        // and the red fill waits for the dialog's confirm button.
        destructive: `border border-destructive bg-destructive text-destructive-foreground ${FILLED_DEPTH} hover:bg-destructive/90 active:bg-destructive/80 focus-visible:ring-2 focus-visible:ring-destructive-foreground ${FILLED_DISABLED}`,
        // The tonal shape with a red label (4.8:1 on the ink tint): danger still reads,
        // and the red fill waits for the dialog's confirm button. It was the outlined
        // shape until the outlined quiet button was retired (2026-11-28, below).
        "destructive-quiet": `${TONAL} text-destructive hover:bg-destructive/[0.1] active:bg-destructive/[0.14] ${TONAL_FOCUS} ${TONAL_DISABLED}`,
        // TINTED, FOR AN ESCALATION SITTING BESIDE THE STEP'S MAIN ACTION. A white
        // outline at the same weight as the main button made "Raise dispute" and
        // "Report fraud" look like equal choices (UX review 2026-11-26). A soft fill
        // in the signal's own colour says what kind of action it is and stays
        // quieter than the solid primary. Labels keep 4.5:1 on their fill:
        // `destructive` on an 8% red wash, `action-foreground` on a 28% amber one.
        // NO EDGE (2026-11-28): the tinted fill with a tinted border was the alert-box
        // recipe the badges and callouts also dropped; the fill alone is the shape.
        "destructive-soft": `bg-destructive/[0.08] text-destructive hover:bg-destructive/[0.12] active:bg-destructive/[0.16] ${TONAL_FOCUS} ${TONAL_DISABLED}`,
        "caution-soft": `bg-action/[0.28] text-action-foreground hover:bg-action/40 active:bg-action/50 ${TONAL_FOCUS} ${TONAL_DISABLED}`,
        // THE OUTLINED QUIET BUTTON IS RETIRED (2026-11-28, design-system audit), and
        // `outline` is now an ALIAS of `secondary`, the tonal button, the way `iris`
        // aliases `default` in `badge.tsx`. A white box with a grey control edge and a
        // drop shadow was the stock shadcn button, and beside borderless badges and a
        // pill composer it was the one part of every screen that still read as a
        // template. Kept as a name so call sites and habits compile, and so any
        // `variant="outline"` written from memory still draws the current button.
        // New code says `secondary`.
        outline: `${TONAL} text-foreground hover:bg-foreground/[0.1] active:bg-foreground/[0.14] ${TONAL_FOCUS} ${TONAL_DISABLED}`,
        // TONAL (2026-11-28, design-system audit): a tint of the ink with NO edge and no
        // drop, Instagram's "View profile" and Apple's grey button. For the quiet action
        // that sits in a bar beside a title (the chat bar's "Open contract"), where an
        // outlined box read as a form control dropped into the chrome. A tint of the INK
        // rather than `--secondary`, so it darkens any surface it sits on by the same
        // step; on the slate rail a slate fill would vanish. The label is the full ink,
        // and a keyboard user gets the same 2px `--ring` frame the filled variants draw.
        secondary: `${TONAL} text-foreground hover:bg-foreground/[0.1] active:bg-foreground/[0.14] ${TONAL_FOCUS} ${TONAL_DISABLED}`,
        // Hover is a tint of the ink, as the tonal button's rest is, so a ghost control
        // darkens a slate rail or a tinted card by the same step it darkens white.
        ghost: `hover:bg-foreground/[0.06] active:bg-foreground/[0.1] focus-visible:ring-2 focus-visible:ring-ring ${TONAL_DISABLED} disabled:bg-transparent`,
        link: `text-foreground underline decoration-iris/55 underline-offset-4 hover:decoration-iris active:decoration-iris active:text-foreground/80 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring ${QUIET_DISABLED}`,
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
