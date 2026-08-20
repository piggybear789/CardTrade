import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

type SharedProps = {
  icon: LucideIcon;
  label: string;
  /** Filled primary chip vs outlined secondary. */
  variant?: 'default' | 'outline';
  /** Extra classes on the Lucide icon (e.g. a larger offer glyph). */
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
    'flex size-12 items-center justify-center rounded-full border transition-[colors,transform] group-active:scale-95',
    variant === 'default'
      ? 'border-primary bg-primary text-primary-foreground group-hover:bg-primary/90'
      : 'border-border bg-card text-foreground shadow-sm group-hover:border-gold/40 group-hover:bg-accent group-hover:text-accent-foreground',
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
      <Icon className={cn('size-5', iconClassName)} />
    </span>
  );

  const body: ReactNode = (
    <>
      {chip}
      <span className="w-full text-center text-body font-semibold leading-tight tracking-[0.01em]">
        {label}
      </span>
    </>
  );

  const sharedClass = cn(
    'group inline-flex w-full touch-manipulation flex-col items-center gap-tight rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
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
