'use client';

// components/contract/ContractDetailList.tsx
//
// SINGLE-CONTEXT INSPECTOR. Item, terms, money, collateral and history share one
// workspace. Selecting a tab swaps the panel instead of expanding the page, keeping
// it aligned with chat and preventing several dense sections from opening at once.
//
// Action-card focus links select the matching tab through `ContractFocusProvider`.
// Optional `explainer` copy surfaces next to each tab via an (i) control.

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
import { CircleHelp, ScrollText } from 'lucide-react';

import { Card } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useContractFocus } from './ContractFocus';

export interface ContractDetailListProps {
  children: ReactNode;
  className?: string;
}

export interface ContractDetailRowProps {
  /** Short noun: Item, Terms, Money, Collateral. */
  label: string;
  /** Plain-language “what is this?” shown from the (i) next to the tab. */
  explainer?: string;
  /** DOM id used by action-card focus links. */
  id?: string;
  /** When true, this row is selected by default on mount. */
  defaultOpen?: boolean;
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
    <TooltipProvider delayDuration={200}>
      <Card
        className={cn(
          'flex h-full min-h-0 flex-col overflow-hidden border-border/90 shadow-sm',
          className,
        )}
      >
        {/* One card surface, divided by rules — matching the chat panel this
            sits beside. See the note in ContractChat. */}
        <div className="flex items-center gap-3 border-b px-4 py-3">
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

        {/* The strip scrolls when the labels outrun the panel, but the native
            bar is suppressed: it drew a grey rail across the full width and
            sat on top of the active tab's gold underline. The clipped next tab
            is the affordance instead.

            The active row's edit action docks at the right end of this same
            strip on wider screens — giving it its own row above the panel
            content cost a full row of vertical space for one small button. On
            phones the strip has no width to spare (the button would bury the
            tabs), so the action moves into the panel there instead. */}
        <div className="flex shrink-0 items-center border-b">
          <div
            className="flex min-w-0 flex-1 overflow-x-auto px-1 sm:px-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="tablist"
            aria-label="Contract details"
          >
            {rows.map((row, index) => {
            const selected = index === activeIndex;
            const explainer = row.props.explainer?.trim();
            return (
              <div
                key={rowKey(row, index)}
                className={cn(
                  // On phones the tabs share the strip evenly so all of them
                  // fit without horizontal scrolling; from `sm` they take
                  // their natural width, left-aligned.
                  'relative flex min-w-0 flex-1 items-center justify-center gap-0.5 sm:flex-none sm:justify-start',
                  selected &&
                    'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-gold',
                )}
              >
                <button
                  id={`${tabsId}-tab-${index}`}
                  type="button"
                  role="tab"
                  tabIndex={selected ? 0 : -1}
                  aria-selected={selected}
                  aria-controls={row.props.id ?? `${tabsId}-panel-${index}`}
                  onClick={() => selectTab(index)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                  className={cn(
                    'touch-manipulation py-2.5 text-xs font-medium transition-colors',
                    explainer ? 'pl-1.5 pr-0.5 sm:pl-3' : 'px-1.5 sm:px-3',
                    'hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    selected ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {row.props.label}
                </button>
                {explainer ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          'mr-1.5 grid size-5 place-items-center rounded-full transition-colors',
                          'text-muted-foreground hover:text-foreground',
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          selected ? 'text-foreground/70' : null,
                        )}
                        aria-label={`What is ${row.props.label}?`}
                        onClick={(event) => {
                          // Keep the tab selected when opening the explainer.
                          event.stopPropagation();
                          selectTab(index);
                        }}
                      >
                        <CircleHelp className="size-3.5" aria-hidden />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      align="start"
                      className="max-w-[16rem] text-pretty leading-relaxed"
                    >
                      {explainer}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            );
          })}
          </div>
          {activeRow.props.action ? (
            <div className="hidden shrink-0 py-1 pl-2 pr-3 sm:block">
              {activeRow.props.action}
            </div>
          ) : null}
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
              <div className="mb-3 flex shrink-0 justify-end sm:hidden">
                {activeRow.props.action}
              </div>
            ) : null}
            {activeRow.props.children}
          </div>
        </section>
      </Card>
    </TooltipProvider>
  );
}

/** Declarative detail consumed by `ContractDetailList`; it does not render alone. */
export function ContractDetailRow(_props: ContractDetailRowProps) {
  return null;
}
