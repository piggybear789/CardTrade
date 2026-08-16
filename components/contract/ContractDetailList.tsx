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
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { CircleHelp, ScrollText } from 'lucide-react';

import { Card } from '@/components/ui/card';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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
  /** Colour variant for the tab label. `destructive` renders in red. */
  variant?: 'default' | 'destructive';
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
  // `Children.toArray` already drops null, undefined and booleans, so what remains is
  // everything a caller meant to supply — the right denominator for the check below.
  const supplied = Children.toArray(children);
  const rows = supplied.filter(
    (child): child is ReactElement<ContractDetailRowProps> =>
      isValidElement<ContractDetailRowProps>(child) && child.type === ContractDetailRow,
  );

  // COMPLAIN ABOUT ANYTHING DROPPED, in development.
  //
  // The filter above matches on `child.type === ContractDetailRow`, an exact identity
  // check, so a row WRAPPED in a component of its own — `<TradeTermsRow>` returning a
  // `<ContractDetailRow>` — does not match and is discarded without a word.
  //
  // That silence cost a severity-4 bug. The trade room's Terms row was wrapped, so its
  // whole tab vanished, taking the delivery-address panel with it. On a posted trade
  // past collateral the room then said "Neither of you can post until both addresses
  // are on the contract" while offering no way to add one: an unfinishable trade, and
  // nothing anywhere reported a problem.
  //
  // Dev-only and a warning rather than a throw: a missing tab should be shouted about
  // in development, not turned into a white screen in production.
  if (process.env.NODE_ENV !== 'production' && rows.length !== supplied.length) {
    const dropped = supplied.length - rows.length;
    console.error(
      `[ContractDetailList] ignored ${dropped} child${dropped === 1 ? '' : 'ren'} that ` +
        'is not a <ContractDetailRow>. A row wrapped in its own component will NOT be ' +
        'picked up — call the helper as a function so the element it returns is the row ' +
        'itself, or inline the <ContractDetailRow>.',
    );
  }

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
  const panelRef = useRef<HTMLDivElement | null>(null);

  // RESET THE SCROLL WHEN THE TAB CHANGES. The panel body is one persistent
  // element that swaps its children, so React reuses the DOM node across tab
  // changes — and `scrollTop` lives on the node, not in state. Reading History
  // half way down and then tapping Money opened Money already scrolled, landing
  // mid-content or in whitespace with no indication anything was above.
  //
  // Keyed off `activeIndex` rather than a `key` on the element so a heavy panel
  // (the Item tab and its images) is not torn down and remounted just to move a
  // scroll offset.
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
  }, [activeIndex]);

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
        {/* One card surface, divided by rules — matching the chat panel this
            sits beside. See the note in ContractChat. */}
        <div className="flex items-center gap-cozy border-b px-group py-cozy">
          <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-card text-muted-foreground">
            <ScrollText className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            {/* Matches the chat panel's own heading exactly (`text-body
                font-semibold`) — the two panels sit side by side, so a different
                weight or size on one reads as a hierarchy that is not there.
                It was `text-heading font-bold tracking-wide`, and `text-heading`
                is not in the type scale at all: Tailwind emitted nothing for it,
                so the heading fell back to the inherited 16px. */}
            <h2 className="text-body font-semibold">Contract Details</h2>
            <p className="truncate text-meta text-muted-foreground">
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
        <div className="flex min-h-10 shrink-0 items-stretch border-b">
          <div
            className="flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden px-1 sm:px-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] sm:[mask-image:none]"
            role="tablist"
            aria-label="Contract details"
          >
            {rows.map((row, index) => {
            const selected = index === activeIndex;
            const explainer = row.props.explainer?.trim();
            const isDestructive = row.props.variant === 'destructive';
            return (
              <div
                key={rowKey(row, index)}
                className={cn(
                  // On phones the tabs share the strip evenly so all of them
                  // fit without horizontal scrolling; from `sm` they take
                  // their natural width, left-aligned. Labels must stay on one
                  // line (`truncate` + `nowrap`) — wrapping grew the strip and
                  // let text paint over adjacent tabs (e.g. Terms).
                  'relative flex min-w-0 flex-1 items-center justify-center gap-0.5 overflow-hidden sm:flex-none sm:justify-start sm:overflow-visible',
                  selected &&
                    'after:absolute after:inset-x-2 after:bottom-0 after:z-10 after:h-0.5 after:bg-gold',
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
                    'min-w-0 truncate whitespace-nowrap touch-manipulation py-2.5 text-[0.6875rem] font-medium transition-colors',
                    explainer ? 'pl-1.5 pr-0.5 sm:pl-3' : 'px-1.5 sm:px-3',
                    'hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    isDestructive
                      ? 'text-destructive'
                      : selected ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {row.props.label}
                </button>
                {explainer ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          'mr-0.5 grid size-8 place-items-center rounded-full transition-colors',
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
                    </PopoverTrigger>
                    <PopoverContent
                      side="bottom"
                      align="start"
                      className="max-w-[16rem] text-pretty text-body"
                    >
                      {explainer}
                    </PopoverContent>
                  </Popover>
                ) : null}
              </div>
            );
          })}
          </div>
          {activeRow.props.action ? (
            <div className="hidden shrink-0 items-center self-center py-1 pl-2 pr-3 sm:flex">
              {activeRow.props.action}
            </div>
          ) : null}
        </div>

        <section
          id={activeRow.props.id ?? `${tabsId}-panel-${activeIndex}`}
          role="tabpanel"
          aria-labelledby={`${tabsId}-tab-${activeIndex}`}
          className={cn(
            'flex min-h-0 flex-1 scroll-mt-[calc(4rem+1px+env(safe-area-inset-top))] flex-col transition-colors duration-300',
            focusedId === activeRow.props.id && 'bg-gold/10',
            activeRow.props.className,
          )}
        >
          <div
            ref={panelRef}
            className={cn(
              // `overscroll-contain` only from `lg`, where this panel sits in a
              // bounded split and the page behind it does not scroll. Below `lg`
              // the room stacks and the PAGE is the scroller, so containment
              // dead-ended the gesture: a swipe that reached the bottom of the
              // panel stopped there instead of carrying on down the page, and the
              // reader had to lift and re-swipe outside the panel to continue.
              'flex min-h-0 flex-1 flex-col overflow-y-auto bg-card p-group text-body lg:overscroll-contain',
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
  );
}

/** Declarative detail consumed by `ContractDetailList`; it does not render alone. */
export function ContractDetailRow(_props: ContractDetailRowProps) {
  return null;
}
