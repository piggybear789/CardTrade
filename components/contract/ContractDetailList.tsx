'use client';

// components/contract/ContractDetailList.tsx
//
// SINGLE-CONTEXT INSPECTOR. Item, terms, money, collateral and history share one
// workspace. Selecting a tab swaps the panel instead of expanding the page, keeping
// it aligned with chat and preventing several dense sections from opening at once.
//
// Action-card focus links select the matching tab through `ContractFocusProvider`.

import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ScrollText } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useContractFocus } from './ContractFocus';

export interface ContractDetailListProps {
  children: ReactNode;
  className?: string;
}

export interface ContractDetailRowProps {
  /** Short noun: Item, Terms, Money, Collateral. */
  label: string;
  /** DOM id used by action-card focus links. */
  id?: string;
  /** Current value shown beneath the selected tab. */
  summary?: ReactNode;
  /** Contextual edit control for this detail. */
  action?: ReactNode;
  /** Additional classes for the panel body. */
  contentClassName?: string;
  children: ReactNode;
  className?: string;
}

function rowKey(row: ReactElement<ContractDetailRowProps>, index: number): string {
  return row.props.id ?? `${row.props.label}-${index}`;
}

/** A fixed-height, single-selection inspector for binding contract details. */
export function ContractDetailList({ children, className }: ContractDetailListProps) {
  const rows = Children.toArray(children).filter(
    (child): child is ReactElement<ContractDetailRowProps> =>
      isValidElement<ContractDetailRowProps>(child) && child.type === ContractDetailRow,
  );
  const initialIndex = Math.max(
    rows.findIndex((row) => row.props.defaultOpen),
    0,
  );
  const [activeKey, setActiveKey] = useState(() =>
    rows[initialIndex] ? rowKey(rows[initialIndex], initialIndex) : '',
  );
  const { focusedId } = useContractFocus();
  const tabsId = useId();
  const focusedIndex = focusedId
    ? rows.findIndex((row) => row.props.id === focusedId)
    : -1;
  const storedIndex = rows.findIndex((row, index) => rowKey(row, index) === activeKey);
  const activeIndex = focusedIndex >= 0 ? focusedIndex : Math.max(storedIndex, 0);
  const activeRow = rows[activeIndex] ?? null;

  useEffect(() => {
    if (focusedIndex >= 0) setActiveKey(rowKey(rows[focusedIndex], focusedIndex));
  }, [focusedIndex, rows]);

  useEffect(() => {
    if (rows.length > 0 && storedIndex < 0) setActiveKey(rowKey(rows[0], 0));
  }, [rows, storedIndex]);

  function selectTab(index: number, moveFocus = false) {
    const row = rows[index];
    if (!row) return;
    setActiveKey(rowKey(row, index));
    if (moveFocus) {
      requestAnimationFrame(() => {
        document.getElementById(`${tabsId}-tab-${index}`)?.focus();
      });
    }
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % rows.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + rows.length) % rows.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = rows.length - 1;
    else return;
    event.preventDefault();
    selectTab(next, true);
  }

  if (!activeRow) return null;

  return (
    <Card
      className={cn(
        'flex h-full min-h-0 flex-col overflow-hidden border-border/90 shadow-sm',
        className,
      )}
    >
      <div className="flex items-center gap-3 border-b bg-muted/20 px-4 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-card text-muted-foreground">
          <ScrollText className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Contract Details</h2>
          <p className="truncate text-xs text-muted-foreground">
            Review one part of the agreement at a time
          </p>
        </div>
      </div>

      <div
        className="flex shrink-0 overflow-x-auto border-b bg-card px-2"
        role="tablist"
        aria-label="Contract details"
      >
        {rows.map((row, index) => {
          const selected = index === activeIndex;
          return (
            <button
              key={rowKey(row, index)}
              id={`${tabsId}-tab-${index}`}
              type="button"
              role="tab"
              tabIndex={selected ? 0 : -1}
              aria-selected={selected}
              aria-controls={row.props.id ?? `${tabsId}-panel-${index}`}
              onClick={() => selectTab(index)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              className={cn(
                'relative shrink-0 touch-manipulation px-3 py-2.5 text-xs font-medium transition-colors',
                'hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                selected
                  ? 'text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-gold'
                  : 'text-muted-foreground',
              )}
            >
              {row.props.label}
            </button>
          );
        })}
      </div>

      <section
        id={activeRow.props.id ?? `${tabsId}-panel-${activeIndex}`}
        role="tabpanel"
        aria-labelledby={`${tabsId}-tab-${activeIndex}`}
        className={cn(
          'flex min-h-0 flex-1 scroll-mt-20 flex-col transition-colors duration-300',
          focusedId === activeRow.props.id && 'bg-gold/10',
          activeRow.props.className,
        )}
      >
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain bg-card p-4 text-sm',
            activeRow.props.contentClassName,
          )}
        >
          {activeRow.props.summary ? (
            <p className="sr-only">{activeRow.props.summary}</p>
          ) : null}
          {activeRow.props.action ? (
            <div className="mb-3 flex shrink-0 justify-end">{activeRow.props.action}</div>
          ) : null}
          {activeRow.props.children}
        </div>
      </section>
    </Card>
  );
}

/** Declarative detail consumed by `ContractDetailList`; it does not render alone. */
export function ContractDetailRow(_props: ContractDetailRowProps) {
  return null;
}
