'use client';

// components/ui/accordion.tsx
//
// shadcn/ui accordion on Radix, with two deviations from stock.
//
// Focus is a transparent border that turns iris, not a ring, matching the rest
// of the app. The reason it settled there: setting `overflow-y-auto` on one axis
// makes an element a scroll container on both, so a ring-offset on any control
// near that container's edge is clipped. The marketplace rail — the first thing
// to mount this — is exactly such a container. See MarketplaceNav and
// CatalogControls for the same treatment.
//
// The trigger does not underline on hover. Stock does, and in the dense control
// lists this is used for that reads as a link to somewhere rather than a section
// that opens in place.
//
// Reduced motion needs no handling here: globals.css neutralises animation
// duration globally under `prefers-reduced-motion: reduce`.

import * as React from 'react';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { HugeiconsIcon } from '@hugeicons/react';
import { ChevronDownIcon } from '@hugeicons/core-free-icons';

import { cn } from '@/lib/utils';

const Accordion = AccordionPrimitive.Root;

function AccordionItem({
  className,
  ref,
  ...props
}: React.ComponentPropsWithRef<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      ref={ref}
      className={cn('border-b border-border', className)}
      {...props}
    />
  );
}

function AccordionTrigger({
  className,
  children,
  headingAs: Heading = 'h3',
  ref,
  ...props
}: React.ComponentPropsWithRef<typeof AccordionPrimitive.Trigger> & {
  /**
   * Element Radix's header renders as. Stock is `h3`, which is right when the
   * section is part of the document outline. Pass `div` when it is not — a
   * filter group in a rail is a disclosure, not a heading, and emitting an `h3`
   * under a page `h1` puts a phantom level in the heading list for no gain. The
   * trigger is a button with `aria-expanded` and `aria-controls` either way, so
   * nothing is lost by dropping the heading element.
   */
  headingAs?: 'h2' | 'h3' | 'h4' | 'div';
}) {
  return (
    <AccordionPrimitive.Header asChild>
      <Heading className="flex">
        <AccordionPrimitive.Trigger
          ref={ref}
          className={cn(
            'flex flex-1 items-center justify-between gap-2 rounded-md py-2 text-left text-body font-medium transition-colors border border-transparent focus:outline-none focus-visible:border-iris [&[data-state=open]>svg]:rotate-180',
            className,
          )}
          {...props}
        >
          {children}
          <HugeiconsIcon icon={ChevronDownIcon}
            className="size-4 shrink-0 text-muted-foreground transition-transform duration-200"
            aria-hidden="true"
          />
        </AccordionPrimitive.Trigger>
      </Heading>
    </AccordionPrimitive.Header>
  );
}

function AccordionContent({
  className,
  children,
  ref,
  ...props
}: React.ComponentPropsWithRef<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      ref={ref}
      className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
      {...props}
    >
      <div className={cn('pb-group pt-0', className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
