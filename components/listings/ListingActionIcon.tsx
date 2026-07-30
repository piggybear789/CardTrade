import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

type SharedProps = {
  icon: LucideIcon;
  label: string;
  /** Filled primary chip vs outlined secondary. */
  variant?: 'default' | 'outline';
  className?: string;
};

type ListingActionIconProps = SharedProps &
  (
    | ({ href: string } & Omit<
        ComponentPropsWithoutRef<typeof Link>,
        'href' | 'className' | 'children'
      >)
    | ({ href?: undefined } & Omit<
        ComponentPropsWithoutRef<'button'>,
        'className' | 'children'
      >)
  );

function chipClass(variant: 'default' | 'outline') {
  return cn(
    'flex size-12 items-center justify-center rounded-full border transition-colors',
    variant === 'default'
      ? 'border-primary bg-primary text-primary-foreground group-hover:bg-primary/90'
      : 'border-input bg-card text-foreground shadow-sm group-hover:border-gold/50 group-hover:bg-accent group-hover:text-accent-foreground',
  );
}

/**
 * Compact listing CTA: round icon chip with the action label underneath.
 * Used for Buy / Trade / Offer on the item detail page.
 */
export const ListingActionIcon = forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  ListingActionIconProps
>(function ListingActionIcon(
  { icon: Icon, label, variant = 'outline', className, href, ...props },
  ref,
) {
  const chip = (
    <span className={chipClass(variant)} aria-hidden="true">
      <Icon className="size-5" />
    </span>
  );

  const body: ReactNode = (
    <>
      {chip}
      <span className="w-full text-center text-[0.6875rem] font-semibold leading-tight tracking-[0.01em] sm:text-xs">
        {label}
      </span>
    </>
  );

  const sharedClass = cn(
    'group inline-flex w-full touch-manipulation flex-col items-center gap-1.5 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    className,
  );

  if (href != null) {
    return (
      <Link
        href={href}
        className={sharedClass}
        ref={ref as React.Ref<HTMLAnchorElement>}
        {...(props as Omit<
          ComponentPropsWithoutRef<typeof Link>,
          'href' | 'className' | 'children'
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
      ref={ref as React.Ref<HTMLButtonElement>}
      {...(props as Omit<ComponentPropsWithoutRef<'button'>, 'className' | 'children'>)}
    >
      {body}
    </button>
  );
});
