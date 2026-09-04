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
import { TabIndicator } from '@/components/motion/TabIndicator';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useContractFocus } from './ContractFocus';
import { useContractSplit } from './useContractSplit';

export interface ContractDetailListProps {
  children: ReactNode;
  /**
   * Drop the card shell and the "Contract Details" heading, moving the active
   * row's `action` control onto the tab strip.
   *
   * Defaults to true below the split, where `ContractLiveRow` shows this list
   * in a sheet that already carries a title: the card would be a card inside a
   * card and the heading a second heading under the sheet's own.
   */
  embedded?: boolean;
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
  /**
   * Heading inside the panel, above the content. Defaults to {@link label}.
   *
   * Set it only where the tab needs to say more than its tab did — the strip has
   * room for one word, the panel has room for the qualifier.
   */
  title?: string;
  /** Current value shown beneath the selected tab. */
  summary?: ReactNode;
  /** Edit control for this detail — rendered in the Contract Details header. */
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
export function ContractDetailList({
  children,
  embedded,
  className,
}: ContractDetailListProps) {
  const split = useContractSplit();
  const inSheet = embedded ?? !split;
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

  const Root = inSheet ? 'div' : Card;

  return (
      <Root
        className={cn(
          'flex h-full min-h-0 flex-col overflow-hidden',
          inSheet ? 'bg-transparent' : 'border-border shadow-sm',
          className,
        )}
      >
        {/* NO TITLE ROW. It was an icon square, "Contract Details", and
            "Review one part of the agreement at a time" — 56px spent naming a
            tab strip that is directly below it and names itself. The subtitle
            was instructions for reading tabs. The row's action moved into the
            end of the strip, which is where the sheet had always put it. */}

        {/* The strip scrolls when the labels outrun the panel, but the native
            bar is suppressed: it drew a grey rail across the full width and
            sat on top of the active tab's iris underline. The clipped next tab
            is the affordance instead. */}
        <div className="flex min-h-11 shrink-0 items-stretch border-b">
          <div
            className="flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden px-1 pr-4 sm:px-2 md:pr-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%-0.75rem),transparent)] md:[mask-image:none]"
            role="tablist"
            aria-label="Contract details"
          >
            {rows.map((row, index) => {
            const selected = index === activeIndex;
            const isDestructive = row.props.variant === 'destructive';
            return (
              <div
                key={rowKey(row, index)}
                className={cn(
                  // Natural width + horizontal scroll at every breakpoint.
                  // Even-split + truncate on phones turned "Protection" into
                  // "Prot…". The clipped next tab is the scroll affordance.
                  'relative flex shrink-0 items-center justify-start gap-0.5',
                )}
              >
                {selected ? (
                  <TabIndicator layoutId={`${tabsId}-indicator`} />
                ) : null}
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
                    'min-h-11 min-w-0 whitespace-nowrap touch-manipulation px-3 py-2.5 text-meta font-medium transition-colors',
                    'hover:text-foreground focus:outline-none focus-visible:border-iris',
                    isDestructive
                      ? 'text-destructive'
                      : selected ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {row.props.label}
                </button>
              </div>
            );
          })}
          </div>
          {activeRow.props.action ? (
            <div className="flex shrink-0 items-center border-l px-cozy">
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
            focusedId === activeRow.props.id && 'bg-iris/10',
            activeRow.props.className,
          )}
        >
          <div
            ref={panelRef}
            className={cn(
              // Contained wherever this panel is the bounded scroller: the
              // desktop split, and the phone sheet. It stays uncontained in
              // between, where the room stacks and the PAGE scrolls — there,
              // containment dead-ended the gesture, so a swipe reaching the
              // bottom of the panel stopped instead of carrying on down the
              // page, and the reader had to lift and re-swipe outside it.
              'flex min-h-0 flex-1 flex-col overflow-y-auto bg-card p-group text-body',
              inSheet ? 'overscroll-contain' : 'lg:overscroll-contain',
            )}
          >
            {activeRow.props.summary ? (
              <p className="sr-only">{activeRow.props.summary}</p>
            ) : null}

            {/* TITLE AND EXPLAINER PIN TO THE TOP, whatever the content below
                does. They orient the reader, and orientation that drifts to the
                middle of a panel — or worse, moves as the content grows — is not
                orienting anyone.

                The title repeats the tab label by design: the strip is a row of
                one-word targets read left to right, and this is the heading of
                the thing you are now looking at. From `md` up only — see the
                heading itself. */}
            <div className="shrink-0">
              {/* NOT SHOWN ON PHONES. The strip sits directly above this and
                  already marks the active tab with an underline and darker
                  label, so the heading was the same word twice, one line apart,
                  in a sheet where vertical space is the scarce thing.

                  `sr-only` rather than deleted: it is still this panel's heading
                  in the document outline, so heading navigation keeps working.
                  The panel takes its accessible name from the tab button via
                  `aria-labelledby`, so nothing here is load-bearing for that. */}
              <h3 className="sr-only font-display text-meta font-semibold uppercase tracking-wide text-muted-foreground md:not-sr-only">
                {activeRow.props.title ?? activeRow.props.label}
              </h3>
              {/* THE EXPLAINER IS THE FIRST LINE OF THE TAB, not a `?` beside
                  its label. As a popover it cost a click to reach the one
                  sentence that says what the tab is, and only two of the tabs
                  had one — so the strip carried a single lone icon wedged
                  between two labels and read as ragged rather than as a
                  pattern. A tab that needs a sentence of orientation should
                  just open with it. */}
              {/* `md:mt-1`: below `md` the heading above is `sr-only` and out of
                  flow, so this is the first thing in the box and has nothing to
                  be spaced from. */}
              {activeRow.props.explainer?.trim() ? (
                <p className="text-pretty text-body text-muted-foreground md:mt-1">
                  {activeRow.props.explainer}
                </p>
              ) : null}
            </div>

            {/* TOP-ALIGNED. This was briefly centred so a short tab would not
                leave a third of the inspector empty beneath it, but centring
                moved every tab's first line to a different height depending on
                how much it had to say — so switching tabs shifted the content
                up and down under a title that stayed put. A panel that starts
                in the same place every time is easier to read than one with no
                gap at the bottom. */}
            {/* GROW, BUT NEVER SHRINK — `flex: 1 0 auto`. A scroll container's
                content sizes itself and the container scrolls; a content box
                that can be compressed below its own children spills them past
                its own edge, and everything positioned after it — including the
                bottom spacer — then lands halfway up the visible text. That is
                why every attempt at bottom clearance here appeared to do
                nothing: the spacer was present, honoured, and above the text.

                `flex-auto` was the previous attempt at this and does not fix it:
                it is `flex: 1 1 auto`, still shrinkable, and the `min-h-0`
                sitting beside it removed the automatic minimum size that would
                otherwise have held the box open — so the wrapper collapsed to
                the visible height exactly as `flex-1` had. Growing is the only
                part that was ever wanted: a short tab still fills the panel, a
                long one is as tall as its content.

                Nothing inside these tabs scrolls on its own, so no child depends
                on this box being height-constrained. */}
            <div
              className={cn(
                'mt-cozy flex shrink-0 grow flex-col',
                activeRow.props.contentClassName,
              )}
            >
              {activeRow.props.children}
            </div>

            {/* A REAL ELEMENT, NOT `padding-bottom`. The sheet is docked directly
                on the hub bar, so the last row of a tab needs clearance from a
                bar the thumb is already resting on — but this scroller is a flex
                container, and WebKit and Blink both drop a flex scroll
                container's bottom padding once you reach the end of the content.
                Two attempts at `pb-*` here did nothing for that reason. A
                zero-content spacer is a flex item and is honoured. */}
            {inSheet ? <div aria-hidden className="h-section shrink-0" /> : null}
          </div>
        </section>
      </Root>
  );
}

/** Declarative detail consumed by `ContractDetailList`; it does not render alone. */
export function ContractDetailRow(_props: ContractDetailRowProps) {
  return null;
}
