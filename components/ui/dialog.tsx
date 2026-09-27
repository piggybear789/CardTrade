"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { HugeiconsIcon } from '@hugeicons/react';
import { XIcon } from '@hugeicons/core-free-icons';

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-obsidian/80 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200 data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150 data-[state=closed]:ease-in",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

type DialogContentProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> & {
  /**
   * Mobile presentation below `md` (768px, the chrome split):
   * - `sheet` (default) — docks to the bottom with safe-area padding
   * - `center` — floating card (lightbox / media viewers)
   * - `page` — full-viewport wizard (onboarding). Overlay is solid `bg-card`
   *   on phone so the marketplace does not dim behind a page that is the page.
   */
  mobile?: "sheet" | "center" | "page";
  /** Hide the close affordance for required, non-dismissable wizard steps. */
  showClose?: boolean;
};

/**
 * Opacity-only enter/exit (`dialog-fade-*` in tailwind.config.ts). Every presentation
 * uses it except the phone bottom sheet, which slides — see {@link SHEET_SLIDE}.
 *
 * NEVER GIVE A CENTRED PANEL `animate-in` / `animate-out`. A centred panel rests at
 * `-translate-*-1/2`, and `tailwindcss-animate`'s `enter`/`exit` keyframes overwrite
 * `transform` wholesale, so the animation starts from `translate(0, 0)` — the panel's
 * top-left corner on the viewport centre — and the dialog flies in from the bottom
 * right. Seeding the resting offset through the plugin's slide utilities hid this for
 * the old zoom, but the seed had to be repeated per variant and per breakpoint, which
 * is exactly how the photo lightbox shipped flying in.
 *
 * Nor put the two on one element. `animate-in` and `animate-dialog-fade-in` both set
 * `animation-name` at equal specificity, and plugin utilities are emitted after core
 * ones, so `enter` silently wins. The lightbox carried `animate-dialog-fade-in` the
 * whole time; it never ran.
 */
const FADE =
  "data-[state=open]:animate-dialog-fade-in data-[state=closed]:animate-dialog-fade-out";

/** {@link FADE} from `md` up, where the sheet variant becomes a centred card. */
const FADE_MD =
  "md:data-[state=open]:animate-dialog-fade-in md:data-[state=closed]:animate-dialog-fade-out";

/**
 * The phone bottom sheet rises from the edge it is docked to, fading as it comes.
 * It is the one presentation that uses `tailwindcss-animate`, and it can: it rests at
 * `translate(0, 0)`, the keyframes' own default, so there is no offset to lose.
 * Scoped to `max-md` so none of it reaches the centred card above that.
 */
const SHEET_SLIDE =
  "max-md:data-[state=open]:animate-in max-md:data-[state=open]:fade-in-0 max-md:data-[state=open]:slide-in-from-bottom max-md:data-[state=open]:duration-[240ms] max-md:data-[state=open]:ease-[cubic-bezier(0.22,1,0.36,1)] max-md:data-[state=closed]:animate-out max-md:data-[state=closed]:fade-out-0 max-md:data-[state=closed]:slide-out-to-bottom max-md:data-[state=closed]:duration-150 max-md:data-[state=closed]:ease-in";

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({
  className,
  children,
  mobile = "sheet",
  showClose = true,
  onOpenAutoFocus,
  ...props
}, ref) => (
  <DialogPortal>
    <DialogOverlay
      className={mobile === "page" ? "max-md:bg-card" : undefined}
    />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 flex w-full flex-col gap-group border bg-card text-card-foreground shadow-lg outline-none duration-200 focus-visible:border-iris max-md:pl-[max(1rem,env(safe-area-inset-left))] max-md:pr-[max(1rem,env(safe-area-inset-right))]",
        mobile === "sheet" && [
          // Phone: bottom sheet. Children must not shrink — a pinned footer plus
          // flex-shrink was compressing titles/fields instead of letting this
          // scrollport move. `[&>*]:shrink-0` keeps each block its natural height.
          "inset-x-0 bottom-[var(--keyboard-inset,0px)] top-auto max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-top)-var(--keyboard-inset,0px)))] translate-x-0 translate-y-0 gap-cozy overflow-y-auto overscroll-contain rounded-t-2xl border-x-0 border-b-0 p-group pb-[max(1rem,env(safe-area-inset-bottom))] [&>*]:shrink-0",
          SHEET_SLIDE,
          // md+: centred on the viewport (not the content column beside the rail)
          "md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:max-h-[calc(100dvh-3rem)] md:w-[calc(100%-2rem)] md:max-w-xl md:-translate-x-1/2 md:-translate-y-1/2 md:gap-group md:rounded-lg md:border md:border-border md:p-6 md:pb-6",
          FADE_MD,
        ],
        mobile === "center" && [
          "left-1/2 top-1/2 max-h-[calc(100dvh-2rem)] w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-xl p-group",
          FADE,
          "sm:max-h-[calc(100dvh-3rem)] sm:w-[calc(100%-2rem)] sm:p-6",
        ],
        mobile === "page" && [
          // Phone: the wizard IS the page. Full viewport, no sheet chrome.
          // `bottom` tracks `--keyboard-inset` so the footer sits above the
          // software keyboard and the flex scroll region shrinks with it.
          "inset-x-0 top-0 bottom-[var(--keyboard-inset,0px)] h-auto max-h-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 p-group pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] shadow-none",
          // md+: same centred card as the sheet variant
          "md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:max-h-[calc(100dvh-3rem)] md:w-[calc(100%-2rem)] md:max-w-xl md:-translate-x-1/2 md:-translate-y-1/2 md:overflow-y-auto md:rounded-lg md:border md:border-border md:p-6 md:pb-6 md:pt-6 md:shadow-lg",
          // Fades at every width: a full-screen page sliding up would read as navigation.
          FADE,
        ],
        className,
      )}
      {...props}
      onOpenAutoFocus={(event) => {
        onOpenAutoFocus?.(event);
        if (event.defaultPrevented) return;
        // Radix normally focuses the first field, which immediately opens the
        // software keyboard. On touch devices focus the dialog container first;
        // the member can read the prompt and deliberately choose a field.
        if (window.matchMedia('(pointer: coarse)').matches) {
          event.preventDefault();
          if (event.currentTarget instanceof HTMLElement) {
            event.currentTarget.focus({ preventScroll: true });
          }
        }
      }}
    >
      {children}
      {showClose ? (
        // `md:`, not `sm:`, for the step down to 32px: below `md` the default
        // presentation is still the phone bottom sheet, so a 640–767px window was
        // handing a touch surface the pointer-sized target. `focus-visible:opacity-100`
        // because opacity applies to the ring too — at 70% the iris frame would
        // drop under the 3:1 it owes the card.
        <DialogPrimitive.Close className="absolute right-3 top-3 flex size-10 touch-manipulation items-center justify-center rounded-md bg-transparent opacity-80 transition-opacity hover:opacity-100 border border-transparent focus:outline-none focus-visible:border-iris focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-iris focus-visible:opacity-100 disabled:pointer-events-none md:size-8 md:opacity-70">
          <HugeiconsIcon icon={XIcon} className="size-4" aria-hidden="true" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      ) : null}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col gap-1.5 pr-12 text-left",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // In flow, not sticky. Pinning Back/Continue to the sheet bottom reserved
      // a bar (two stacked full-width buttons on phone) and flexed the title
      // and fields into the leftover sliver — especially once the keyboard
      // inset shrinks max-height. Actions sit after the content; the sheet
      // scrolls if needed. Phone: one row so two actions share a line.
      "flex flex-row gap-snug [&>a]:min-w-0 [&>a]:flex-1 [&>button]:min-w-0 [&>button]:flex-1",
      "md:justify-end md:[&>a]:flex-none md:[&>button]:flex-none",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-subhead font-semibold leading-snug tracking-tight",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-body text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
