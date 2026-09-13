// components/account/CashSalesSection.tsx
//
// Shared list UI for Purchases and Sales. One row per Cash_Sale: the snapshotted item
// photo and title, the amount, WHAT THE CONTRACT IS WAITING ON, and a status badge.
// `variant` changes the empty-state copy, the column heading and the accessible list
// name between buying and selling, and nothing else — the two sides of a contract read
// the same list because they are looking at the same contract.
//
// THE NEXT-STEP COLUMN IS THE POINT OF THE REWRITE. This was a photo, a title, a price
// and a badge, so a buyer with four open purchases could see that one said "Inspection"
// and still have to open it to find out that the clock was running on THEM. The step
// sentence comes down with the row (see `ContractNextMove`) and is rendered by the
// shared cell in `ContractRow.tsx`.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { ShoppingBag01Icon, Tag01Icon } from '@hugeicons/core-free-icons';

import { formatAud, formatRelativeTime } from '@/lib/format';
import type { CashSaleSummary } from '@/lib/actions/account';
import { EmptyState } from '@/components/account/EmptyState';
import {
  CONTRACT_ROW_GRID,
  ContractRowTable,
  ContractRowThumb,
  NextMoveCell,
} from '@/components/account/ContractRow';
// One status vocabulary for cash sales, shared with the contract room.
import { CashSaleStatusBadge } from '@/components/sales/CashSaleStatusBadge';
import { cn } from '@/lib/utils';

export function CashSalesSection({
  sales,
  variant,
  empty,
}: {
  sales: CashSaleSummary[];
  variant: 'purchases' | 'sales';
  /**
   * What to show instead of the default when the list is empty.
   *
   * The default invites the member to list or browse, which is right for an account
   * with no contracts and wrong for one whose whose-move filter simply matched nothing.
   * The page owns the scope, so the page supplies that state — see
   * `ContractScopeEmptyState`.
   */
  empty?: ReactNode;
}) {
  if (sales.length === 0) {
    if (empty) return <>{empty}</>;

    return variant === 'purchases' ? (
      <EmptyState
        icon={<HugeiconsIcon icon={ShoppingBag01Icon} className="size-6" aria-hidden />}
        title="No Purchases Yet"
        description="Browse the marketplace and buy your first collectible."
        ctaLabel="Browse the marketplace"
        ctaHref="/"
      />
    ) : (
      <EmptyState
        icon={<HugeiconsIcon icon={Tag01Icon} className="size-6" aria-hidden />}
        title="No Sales Yet"
        description="List an item so buyers can purchase it outright."
        ctaLabel="List an item"
        ctaHref="/listings/new"
      />
    );
  }

  const buying = variant === 'purchases';

  return (
    <ContractRowTable
      subject="Item"
      label={buying ? 'Your purchases' : 'Your sales'}
    >
      {sales.map((sale) => {
        const title = sale.itemTitle ?? 'Item';
        const opened = formatRelativeTime(sale.createdAt);

        return (
          <li key={sale.id} className={cn(CONTRACT_ROW_GRID, 'px-group py-cozy')}>
            <ContractRowThumb imagePath={sale.itemImagePath} />

            <div className="min-w-0">
              {/* THE LINK IS THE TITLE, not the whole row. A row now holds a clamped
                  two-line sentence and a badge, and wrapping all of it in one anchor
                  made a 90px-tall link whose accessible name was every word in it. */}
              <Link
                href={`/sales/${sale.id}`}
                transitionTypes={['nav-forward']}
                className="block truncate rounded-sm border border-transparent text-body font-semibold underline-offset-2 hover:underline focus:outline-none focus-visible:border-iris"
              >
                {title}
              </Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-cozy gap-y-tight text-meta text-muted-foreground">
                <span className="font-semibold tabular-nums text-foreground">
                  {formatAud(sale.amountCents)}
                </span>
                <span>{buying ? 'from' : 'to'} {sale.counterpartyName}</span>
                {opened ? (
                  <span suppressHydrationWarning>opened {opened}</span>
                ) : null}
                {/* The status badge lives here below `md`, where it has no column of its
                    own. A `div` rather than a `p` because `Badge` renders a `<div>` and
                    that nesting is invalid HTML — see the hydration note in
                    `ListingsSection`. */}
                <CashSaleStatusBadge status={sale.status} className="md:hidden" />
              </div>
              {/* The desktop next-step column, folded in below `md` — where it is the
                  first thing a member is looking for, so it sits directly under the
                  title rather than behind a tap. */}
              <NextMoveCell move={sale.nextMove} className="mt-1 md:hidden" />
            </div>

            <NextMoveCell move={sale.nextMove} className="hidden md:flex" />

            <span className="hidden justify-end md:flex">
              <CashSaleStatusBadge status={sale.status} className="shrink-0" />
            </span>
          </li>
        );
      })}
    </ContractRowTable>
  );
}
