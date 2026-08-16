import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * THE DESIGN TOKENS HAVE TO BE DECLARED HERE TOO, or `cn()` silently stops
 * resolving conflicts involving them.
 *
 * tailwind-merge recognises a utility by parsing its VALUE against the scales it
 * knows, and it ships with Tailwind's default scales — not ours. `p-group` is
 * therefore an unknown class rather than a padding class, so a call site passing
 * it to a primitive whose base is `p-6 pt-0` (`CardContent`, `CardFooter`) keeps
 * BOTH: the override lands, the `pt-0` survives it, and because Tailwind emits
 * `pt` after `p` the element ends up with no top padding at all.
 *
 * That is not hypothetical. It is what removed the top padding from every
 * contract-room header and action card — the title and the buttons sat flush
 * against the card's top edge while the other three sides were correct, which
 * reads as a broken card rather than as a class-merge problem.
 *
 * Keep this list in step with `theme.extend.spacing` in `tailwind.config.ts`.
 * Adding a token there without adding it here does not fail a build; it just
 * quietly stops overriding.
 *
 * THE TYPE SCALE IS WORSE THAN A MISSED OVERRIDE, because `text-*` is ambiguous.
 * tailwind-merge decides whether `text-x` is a SIZE or a COLOUR by testing the
 * value against the font-size scale it knows; anything it does not recognise is
 * classified as a colour. So `text-meta` was read as a colour, and every
 * `cn('… text-meta … text-muted-foreground')` resolved the two as one conflict and
 * dropped the size — leaving the element at the inherited 16px while the source
 * plainly asked for 12px.
 *
 * That is what rendered the contract chat's sender name, message body and
 * timestamp at 16px: all three pass a token AND a colour through `cn()`. It is
 * silent by construction — the class is not invalid, it is discarded — so it can
 * only be caught here. Keep this list in step with `theme.extend.fontSize`.
 * (`text` is tailwind-merge v3's name for the font-size namespace.)
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: ["tight", "snug", "cozy", "group", "section", "region"],
      text: ["meta", "body", "lead", "subhead", "head", "display"],
    },
  },
});

/**
 * Merge Tailwind CSS class names, resolving conflicting utilities.
 * Used by all shadcn/ui primitives.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
