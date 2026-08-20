// components/contract/ContractMoneyTable.tsx
//
// The label/value breakdown shared by every contract room: payment terms,
// money terms, collateral, and — in the compact layout — the fulfillment terms
// summary. One primitive means the row rhythm, tabular alignment and total emphasis
// are the same wherever terms or money are disclosed.
//
// Rows may carry their own `action` (a dialog trigger) so editing sits beside the
// value it changes, which is what lets three former sections collapse into one.
//
// Values are always pre-formatted by the caller with `formatAud`, keeping the
// integer-cents rule at the boundary rather than in a presentational component.

import { cn } from '@/lib/utils';
import type { ContractMoneyRow } from './types';

export interface ContractMoneyTableProps {
  rows: ContractMoneyRow[];
  /** Accessible name, e.g. "Payment breakdown". */
  ariaLabel?: string;
  className?: string;
}

/** A bordered label/value breakdown. */
export function ContractMoneyTable({
  rows,
  ariaLabel,
  className,
}: ContractMoneyTableProps) {
  return (
    <dl
      className={cn('space-y-cozy text-body', className)}
      aria-label={ariaLabel}
    >
      {rows.map((row, index) => (
        <div
          key={`${row.label}-${index}`}
          className="flex items-start justify-between gap-cozy"
        >
          <dt
            className={cn(
              'min-w-0',
              row.total ? 'font-semibold' : 'text-muted-foreground',
            )}
          >
            {row.label}
            {row.hint ? (
              <span className="mt-0.5 block whitespace-pre-wrap break-words text-body text-muted-foreground">
                {row.hint}
              </span>
            ) : null}
          </dt>
          <dd className="flex shrink-0 items-center gap-snug text-right">
            <span
              className={cn(
                row.muted
                  ? 'text-muted-foreground'
                  : row.total
                    ? 'text-lead font-semibold tabular-nums'
                    : 'font-medium tabular-nums',
              )}
            >
              {row.value}
            </span>
            {row.action}
          </dd>
        </div>
      ))}
    </dl>
  );
}
