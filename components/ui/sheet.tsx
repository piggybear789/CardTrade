"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { cva, type VariantProps } from "class-variance-authority"
import { HugeiconsIcon } from '@hugeicons/react';
import { XIcon } from '@hugeicons/core-free-icons';

import { cn } from "@/lib/utils"

const Sheet = SheetPrimitive.Root

const SheetTrigger = SheetPrimitive.Trigger

const SheetClose = SheetPrimitive.Close

const SheetPortal = SheetPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-obsidian/80 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200 data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150 data-[state=closed]:ease-in",
      className
    )}
    {...props}
    ref={ref}
  />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

const sheetVariants = cva(
  "fixed z-50 flex flex-col gap-4 bg-background p-6 shadow-lg data-[state=open]:animate-in data-[state=open]:duration-[240ms] data-[state=open]:ease-[cubic-bezier(0.22,1,0.36,1)] data-[state=closed]:animate-out data-[state=closed]:duration-150 data-[state=closed]:ease-in",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b pt-[max(1.5rem,env(safe-area-inset-top))] data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        // UPWARD-ONLY SHADOW, overriding the base `shadow-lg`. A bottom sheet has
        // nothing below it worth shading — either the screen edge, or the mobile
        // hub bar it is docked on. Casting downward there smeared the bar's 1px
        // top border into a soft grey band, which is the one line that has to
        // stay crisp: it is all that separates two white surfaces.
        bottom:
          "inset-x-0 bottom-[var(--keyboard-inset,0px)] max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-top)-var(--keyboard-inset,0px)))] overflow-y-auto overscroll-contain rounded-t-2xl border-t bg-card pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-[0_-10px_30px_hsl(var(--foreground)/0.10)] data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  }
)

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  /** Extra classes for the dimmed backdrop — used to keep the mobile hub clear. */
  overlayClassName?: string;
  /** Override the default close chip (needed on dark sheets — `muted` is cream). */
  closeClassName?: string;
  /**
   * Drop the ✕.
   *
   * For a sheet whose header is a title row the ✕ would sit on top of — and
   * where tapping the backdrop or pressing Escape already dismisses it. Do not
   * use it on a sheet that covers the whole screen: there the ✕ is the only
   * visible way out.
   */
  hideClose?: boolean;
}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(
  (
    {
      side = "right",
      className,
      overlayClassName,
      closeClassName,
      hideClose = false,
      children,
      ...props
    },
    ref,
  ) => (
    <SheetPortal>
      <SheetOverlay className={overlayClassName} />
      <SheetPrimitive.Content
        ref={ref}
        className={cn(sheetVariants({ side }), className)}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <SheetPrimitive.Close
            className={cn(
              "absolute right-3 top-3 flex size-10 touch-manipulation items-center justify-center rounded-md bg-transparent opacity-80 transition-opacity hover:opacity-100 border border-transparent focus:outline-none focus-visible:border-iris disabled:pointer-events-none md:size-8 md:opacity-70",
              closeClassName,
            )}
          >
            <HugeiconsIcon icon={XIcon} className="size-4" aria-hidden="true" />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  ),
)
SheetContent.displayName = SheetPrimitive.Content.displayName

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col gap-1.5 pr-12 text-left", className)}
    {...props}
  />
)
SheetHeader.displayName = "SheetHeader"

const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse gap-2 [&>button]:w-full sm:flex-row sm:justify-end sm:gap-2 sm:[&>button]:w-auto",
      className
    )}
    {...props}
  />
)
SheetFooter.displayName = "SheetFooter"

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-subhead font-semibold text-foreground", className)}
    {...props}
  />
))
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-body text-muted-foreground", className)}
    {...props}
  />
))
SheetDescription.displayName = SheetPrimitive.Description.displayName

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
