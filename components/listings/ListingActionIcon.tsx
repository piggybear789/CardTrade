import { Children, isValidElement, type ComponentPropsWithoutRef, type ReactNode, type Ref } from 'react';
import Link from 'next/link';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';

import { cn } from '@/lib/utils';

type SharedProps = {
  icon: IconSvgElement;
  label: string;
  /** Filled primary chip vs outlined secondary. */
  variant?: 'default' | 'outline';
  /** Extra classes on the icon (e.g. a larger offer glyph). */
  iconClassName?: string;
  className?: string;
};

type ListingActionIconProps = SharedProps &
  (
    | ({ href: string; ref?: Ref<HTMLAnchorElement> } & Omit<
        ComponentPropsWithoutRef<typeof Link>,
        'href' | 'className' | 'children' | 'ref'
      >)
    | ({ href?: undefined; ref?: Ref<HTMLButtonElement> } & Omit<
        ComponentPropsWithoutRef<'button'>,
        'className' | 'children' | 'ref'
      >)
  );

function chipClass(variant: 'default' | 'outline') {
  return cn(
    'flex size-9 shrink-0 items-center justify-center rounded-md border transition-[colors,transform] group-active:scale-95 group-focus-visible:border-iris md:size-12 md:rounded-full',
    variant === 'default'
      ? 'border-primary bg-primary text-primary-foreground group-hover:bg-primary/90'
      : 'border-input bg-card text-foreground group-hover:border-foreground/60 group-hover:bg-accent group-hover:text-accent-foreground',
  );
}

/**
 * Compact listing CTA: round icon chip with the action label underneath.
 * Used for Propose trade, Make an offer and Message seller in the listing page's
 * action row (`ListingActionRow`), and for Save and Report via their `action` / `icon`
 * appearances.
 */
export function ListingActionIcon({
  icon: Icon,
  label,
  variant = 'outline',
  iconClassName,
  className,
  href,
  ref,
  ...props
}: ListingActionIconProps) {
  const chip = (
    <span className={chipClass(variant)} aria-hidden="true">
      <HugeiconsIcon icon={Icon} className={cn('size-5', iconClassName)} />
    </span>
  );

  const body: ReactNode = (
    <>
      {chip}
      <span className="min-w-0 text-left text-body font-semibold leading-tight md:w-full md:text-center">
        {label}
      </span>
    </>
  );

  const sharedClass = cn(
    'group inline-flex w-full min-h-12 touch-manipulation flex-row items-center justify-start gap-cozy rounded-lg border border-border bg-card px-group py-cozy focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:min-h-0 md:flex-col md:items-center md:justify-center md:gap-tight md:rounded-md md:border-transparent md:bg-transparent md:px-0 md:py-0',
    className,
  );

  if (href != null) {
    return (
      <Link
        href={href}
        className={sharedClass}
        ref={ref as Ref<HTMLAnchorElement>}
        {...(props as Omit<
          ComponentPropsWithoutRef<typeof Link>,
          'href' | 'className' | 'children' | 'ref'
        >)}
      >
        {body}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={sharedClass}
      ref={ref as Ref<HTMLButtonElement>}
      {...(props as Omit<ComponentPropsWithoutRef<'button'>, 'className' | 'children' | 'ref'>)}
    >
      {body}
    </button>
  );
}

/**
 * The listing page's row of round `ListingActionIcon` chips, under Buy now.
 *
 * Null children drop out, so the caller passes every chip behind its own condition
 * (Offer only on a single listing with a seller disclosure, Trade only when allowed,
 * Message only when the viewer can message) and the row lays out what is left.
 * Renders nothing when no chip is left.
 *
 * ONE HEIGHT FOR ONE TO THREE CHIPS. From `md` every chip is a 48px circle over one
 * `text-body leading-tight` label, the slots are equal-basis and CENTRED, so a missing
 * chip closes up sideways and moves nothing above or below the row. `max-w-32` (128px)
 * is wide enough for "Message seller" on one line, and stops two chips spreading to the
 * column's edges. Below `md` the chips are full-width rows stacked, as before.
 */
export function ListingActionRow({
  label,
  children,
  className,
}: {
  /** Accessible name of the group, e.g. "Other ways to deal". */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const actions = Children.toArray(children);
  if (actions.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'flex flex-col gap-snug md:flex-row md:items-start md:justify-center',
        className,
      )}
    >
      {actions.map((action, index) => (
        // The key `Children.toArray` assigned, so a sibling chip toggling cannot
        // remount (and close) another chip's dialog.
        <div
          key={isValidElement(action) && action.key != null ? action.key : index}
          className="min-w-0 md:max-w-32 md:flex-1 md:basis-0">
          {action}
        </div>
      ))}
    </div>
  );
}
