import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';
import Link from 'next/link';
import { Icon, type IconGlyph } from '@/components/ui/icon';

import { cn } from '@/lib/utils';

type SharedProps = {
  icon: IconGlyph;
  label: string;
  /** Filled primary chip vs the tonal secondary (`outline` is the legacy name). */
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
    'flex size-9 shrink-0 items-center justify-center rounded-md border transition-colors group-focus-visible:border-ring md:size-12 md:rounded-md',
    variant === 'default'
      ? 'border-primary bg-primary text-primary-foreground group-hover:bg-primary/90'
      : // Tonal, as the quiet button is (2026-11-28): an ink tint, no edge. On a phone
        // the ROW is the tinted control and this chip only holds the glyph, so two
        // tints never stack; from `md` the row is bare and the chip takes the tint.
        'border-transparent text-foreground md:bg-foreground/[0.06] md:group-hover:bg-foreground/[0.1]',
  );
}

/**
 * Compact listing CTA: round icon chip with the action label underneath.
 * Used for Buy / Trade / Offer on the item detail page.
 */
export function ListingActionIcon({
  icon: Glyph,
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
      <Icon icon={Glyph} className={cn('size-5', iconClassName)} />
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
    // PHONE: a full-width tonal row (2026-11-28), the quiet button's tint and inset
    // focus ring; it was a bordered white row. FROM `md`: a bare column, the chip
    // above its label, and the chip carries the tint and the focus edge.
    'group inline-flex w-full min-h-12 touch-manipulation flex-row items-center justify-start gap-cozy rounded-md bg-foreground/[0.06] px-group py-cozy transition-colors hover:bg-foreground/[0.1] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:min-h-0 md:flex-col md:items-center md:justify-center md:gap-tight md:rounded-md md:bg-transparent md:px-0 md:py-0 md:hover:bg-transparent md:focus-visible:ring-0',
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
