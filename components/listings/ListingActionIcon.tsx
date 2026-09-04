import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';
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
      : 'border-border bg-card text-foreground shadow-sm group-hover:border-iris/50 group-hover:bg-accent group-hover:text-accent-foreground',
  );
}

/**
 * Compact listing CTA: round icon chip with the action label underneath.
 * Used for Buy / Trade / Offer on the item detail page.
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
      <span className="min-w-0 text-left text-body font-semibold leading-tight tracking-[0.01em] md:w-full md:text-center">
        {label}
      </span>
    </>
  );

  const sharedClass = cn(
    'group inline-flex w-full min-h-12 touch-manipulation flex-row items-center justify-start gap-3 rounded-lg border border-border bg-card px-4 py-3 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:min-h-0 md:flex-col md:items-center md:justify-center md:gap-tight md:rounded-md md:border-transparent md:bg-transparent md:px-0 md:py-0',
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
