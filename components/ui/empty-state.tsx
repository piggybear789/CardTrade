// components/ui/empty-state.tsx
//
// Shared state for empty collections and first-use guidance. Keeps icon, copy,
// spacing, and mobile action width consistent across features. See `variant` for
// the two jobs it does — a placeholder inside a section, or a whole route — which
// diverge on phones, and `fill` for the case in between: a section state that is
// the only thing on the page below `md`, which is every empty hub.

import type { ReactNode } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function EmptyState({
  icon,
  title,
  description,
  action,
  help,
  className,
  compact = false,
  hideActionOnMobile = false,
  fill = false,
  titleAs: Title = 'h2',
  variant = 'section',
}: {
  icon?: ReactNode;
  title: string;
  description: ReactNode;
  action?: {
    label: string;
    variant?: 'default' | 'outline';
    disabled?: boolean;
  } & (
    | {
        href: string;
        /** Direction to hand `DirectionalTransition`, e.g. `['nav-back']` for a way out. */
        transitionTypes?: string[];
        onClick?: never;
      }
    | { onClick: () => void; href?: never; transitionTypes?: never }
  );
  help?: { label: string; href: string };
  className?: string;
  compact?: boolean;
  /** Hide the CTA on phones when the hub already offers the same action. */
  hideActionOnMobile?: boolean;
  /**
   * This state IS the content of its page below `md` — a hub with nothing in it.
   *
   * Purchases, Sales, Offers, Saved, My Listings and an unlisted catalog all have a
   * heading and a scope filter above the state and NOTHING below it. The plain
   * `section` treatment left the copy and its CTA pinned under the tabs with the
   * remaining two thirds of the phone blank, which reads as content that failed to
   * load rather than a list that is empty. `fill` claims the space the list would
   * have taken and centres the state in it, icon included, because at that point it
   * is an island by construction — the objection `section` records to centring only
   * holds when there is more page underneath.
   *
   * Below `md` only. On desktop the state stays where the first row would be, inside
   * the dashed placeholder, so a page with sections below it is unaffected.
   *
   * This needs height handed down to do anything: every ancestor between here and
   * the shell's content column has to be a `flex-1` column. Where the chain is
   * broken it degrades to the top-aligned state instead of breaking the layout, so
   * check the chain when adding a call site.
   */
  fill?: boolean;
  /**
   * Match the state title to its surrounding document outline.
   *
   * `h4` exists because the workspace nests three levels before a section's content:
   * MarketplaceShell owns the `h1`, SectionHeader the `h2`, and a page's own sections
   * are `h3` — so an empty state inside one of those sections is a `h4`. Without it,
   * pages were forced to either mislabel the section or repeat `h3`.
   */
  titleAs?: 'h1' | 'h2' | 'h3' | 'h4';
  /**
   * Which of the two jobs this state is doing. They want opposite things on a phone,
   * and until this existed both got the section treatment.
   *
   * `section` stands in for the first row of a list. When there is more page below
   * it, on phones it stays left-aligned in the reading column and drops its icon — a
   * centred island there reads as unrelated to the section it belongs to. When there
   * is not, pass `fill`, which is the same variant read the other way.
   *
   * `page` IS the route: an identity gate, a 403, a dead end. Nothing frames it and
   * nothing follows it, so it centres at every width, keeps its icon as the focal
   * point, and drops the dashed placeholder border a real page never wanted. Its
   * action is the only thing to press on the route, so it gets a full tap target
   * rather than the inline chip a section uses.
   */
  variant?: 'section' | 'page';
}) {
  const isPage = variant === 'page';
  // A filled section state is centred on phones for the same reason a page state is,
  // so the two share every mobile treatment except the card chrome and the action
  // width. `isPage` alone stays the desktop-centring switch.
  const isCentredOnMobile = isPage || fill;
  const actionSize = 'sm';

  // A page's action is the only thing to press on the route, so on phones it
  // stretches to the reading width. Height stays the compact listing control
  // (`size="sm"` / h-9), not a second oversized bar.
  const actionClassName = cn(
    'mt-snug md:mt-group',
    isPage ? 'max-md:w-full max-md:max-w-xs' : 'w-auto',
    hideActionOnMobile && 'max-md:hidden',
  );

  return (
    <div
      className={cn(
        'flex w-full flex-col items-center justify-center px-group text-center',
        // A section state sits where the first row of content would, under its own
        // heading — so on phones it drops the card chrome and aligns with the rows
        // it replaces. A page state is centred at every width; its shell handles
        // the vertical half.
        isPage
          ? 'max-md:px-0'
          : cn(
              'rounded-lg border border-dashed border-border bg-card max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-0',
              // `flex-1` and nothing else: the root already centres both axes, so
              // taking the column's leftover height is the whole of the change.
              // `flex-basis: 0` means a short viewport still falls back to the
              // content height rather than clipping the CTA.
              fill ? 'max-md:flex-1' : 'max-md:items-start max-md:text-left',
            ),
        compact ? 'py-4 md:py-10' : 'py-5 md:py-14',
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className={cn(
            'items-center justify-center rounded-full border bg-muted text-muted-foreground md:flex md:size-12',
            isCentredOnMobile ? 'flex size-12' : 'mb-1 hidden size-8 md:mb-0',
          )}
        >
          {icon}
        </div>
      ) : null}
      <Title
        className={cn(
          'font-semibold',
          // `text-body` is the list-row size, right for a state standing in for a
          // row. Centred, it puts the title at the description's size and leaves
          // weight alone to carry the hierarchy, which is not enough when the pair
          // is the only thing on the screen.
          isCentredOnMobile ? 'text-lead' : 'text-body md:text-lead',
          icon && (isCentredOnMobile ? 'mt-snug' : 'md:mt-snug'),
        )}
      >
        {title}
      </Title>
      <p className="mt-tight max-w-sm text-pretty text-body text-muted-foreground">
        {description}
      </p>
      {action ? (
        'href' in action && action.href ? (
          <Button
            asChild
            size={actionSize}
            variant={action.variant ?? 'default'}
            className={actionClassName}
          >
            <Link href={action.href} transitionTypes={action.transitionTypes}>
              {action.label}
            </Link>
          </Button>
        ) : (
          <Button
            type="button"
            size={actionSize}
            variant={action.variant ?? 'default'}
            disabled={action.disabled}
            onClick={'onClick' in action ? action.onClick : undefined}
            className={actionClassName}
          >
            {action.label}
          </Button>
        )
      ) : null}
      {help ? (
        <Link
          href={help.href}
          className="mt-3 text-body font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          {help.label}
        </Link>
      ) : null}
    </div>
  );
}
