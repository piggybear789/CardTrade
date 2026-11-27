'use client';

// components/contract/ContractActionCard.tsx
//
// ONE QUESTION AT A TIME. The single card that answers "what do I do now" for any
// contract, and the only place in the room that carries a control for the live step.
//
// It replaces two things that used to coexist and said the same thing twice: the
// seven-row action plan and the separate "Your next step" section. Everything about
// the future lives in the thin `ContractProgressRail`; everything about the past lives
// in the collapsed history row. This card is only ever about NOW.
//
// WHOSE MOVE IT IS LEADS. A step the viewer owns takes the lavender wash, a violet
// edge and a "Your move" pill. A step the other side owns stays plain with no pill:
// its title already names who it is waiting for ("Waiting for Ada to pay"). When it
// is not the viewer's move, the room passes no children and the card shows no buttons.

import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Icon } from '@/components/ui/icon';
import { DotsThreeVerticalIcon, InfoIcon } from '@/components/ui/icons';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { ContractStep } from '@/domain/contract';

/** Visual weight of the card, for terminal or degraded outcomes. */
export type ContractActionTone = 'default' | 'success' | 'warning' | 'danger';

// THE TINT CARRIES THE TONE; THE EDGE STAYS NEUTRAL — see the border rule in
// globals.css. `default` and `warning` used to draw their own violet frames, and
// this card is the single most repeated surface in the product: it is on every
// cash sale and every trade, at every step. A violet-framed card here is most of
// why the interface read as over-emphasised, and the frame was not carrying
// anything the wash does not.
//
// `success` and `danger` keep their coloured edges. Those two are OUTCOMES rather
// than "here is your next move", they are rare, and teal and red each appear
// nowhere else on the surface — the edge is the signal, not decoration.
const TONE: Record<ContractActionTone, string> = {
  default: 'border-border bg-card',
  success: 'border-[hsl(var(--trust)/0.4)] bg-[hsl(var(--trust)/0.06)]',
  warning: 'border-border bg-muted/60',
  danger: 'border-destructive/40 bg-destructive/[0.06]',
};

// The dock is a flat strip inside the chat panel, so it tints only — the
// panel's own border rules divide it from the header and the log.
const STRIP_TONE: Record<ContractActionTone, string> = {
  default: 'bg-card',
  success: 'bg-[hsl(var(--trust)/0.06)]',
  warning: 'bg-muted/60',
  danger: 'bg-destructive/[0.06]',
};

/**
 * The "your move" surface, layered over the `default` tone only — an outcome
 * (success, danger) is louder than whose move it is. The one place the violet edge
 * is spent on this card, because it marks the single thing in the room that is
 * waiting on the reader.
 */
const YOUR_MOVE_CARD = 'border-iris/50 bg-accent/60';
const YOUR_MOVE_STRIP = 'bg-accent/60 shadow-[inset_3px_0_0_hsl(var(--iris))]';

/**
 * The (i) beside a dock title: the step's full explanation, any length, one tap or
 * click away. A popover rather than a tooltip, so it opens on touch as well.
 */
function StepInfo({ children }: { children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-my-1.5 size-6 shrink-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
          aria-label="About this step"
        >
          <Icon icon={InfoIcon} className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-cozy text-body text-muted-foreground">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** Whether the live step is the viewer's to act on. */
function isViewersMove(step: ContractStep | null): boolean {
  return step?.status === 'active' && (step.owner === 'you' || step.owner === 'both');
}

/** "Your move", inline before the step's title. */
function YourMovePill() {
  return (
    <span className="mr-snug inline-flex translate-y-[-1px] items-center rounded-md bg-iris/15 px-1.5 align-middle text-meta font-semibold leading-5 text-iris-ink">
      Your move
    </span>
  );
}

export interface ContractActionCardProps {
  /** The live step. `null` once the contract is finished. */
  step: ContractStep | null;
  /** Title override, when the flow has better copy than the step label. */
  title?: string;
  /** Detail override. */
  detail?: ReactNode;
  /**
   * One line of supporting fact under the detail — a tracking string, an
   * outcome, a figure.
   *
   * A PROP RATHER THAN A CHILD, because children are laid out as controls and
   * pushed to the right of the card. A sentence passed as a child ended up in the
   * button column, where it either squeezed the buttons or wrapped to four lines
   * of its own. Anything that is read rather than clicked belongs here.
   */
  note?: ReactNode;
  tone?: ContractActionTone;
  /** The controls for this step. Omit when the viewer cannot act. */
  children?: ReactNode;
  /**
   * Secondary actions for the header ⋯ menu (Cancel, Decline, and the rest).
   * Rendered to the right of the primary control.
   */
  more?: ReactNode;
  /**
   * `card` is the classic full-width banner. `dock` is the compact form used
   * inside the chat column. `header` is a quiet button cluster for the
   * identity strip — no title, no tint, just the controls.
   */
  appearance?: 'card' | 'dock' | 'header';
  /**
   * The other party's display name. The dock titles a step the other side owns
   * "Post · Waiting for Ada".
   */
  waitingFor?: string;
  className?: string;
}

/** The real children of `node`, with fragments opened and empty slots dropped. */
function flatChildren(node: ReactNode): ReactNode[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? flatChildren(child.props.children)
      : [child],
  );
}

/**
 * ONE BUTTON IN THE DOCK. The rooms pass every control for the step, and in a
 * 22rem chat column two or three of them stacked into a tower beside a sentence
 * squeezed to one word a line ("Report fraud" over "Review the dispute"). The dock
 * keeps the LAST control, which is the step's primary by the rooms' convention
 * (secondary first, primary last, as in a dialog footer), and every other control
 * moves into the ⋯ menu ahead of the room's own `more` items.
 */
function splitPrimary(children: ReactNode): { blocks: ReactNode[]; primary: ReactNode; rest: ReactNode[] } {
  const all = flatChildren(children);
  // A BLOCK IS NOT A MENU ROW. A room marks a panel it passes here (the saved-card
  // row, a meeting-change proposal) with `data-dock="block"`; it keeps its own line
  // above the control row instead of being folded into the menu.
  const isBlock = (node: ReactNode) =>
    isValidElement<Record<string, unknown>>(node) && node.props['data-dock'] === 'block';
  const blocks = all.filter(isBlock);
  const controls = all.filter((node) => !isBlock(node));
  if (controls.length <= 1) return { blocks, primary: controls[0] ?? null, rest: [] };
  return { blocks, primary: controls[controls.length - 1], rest: controls.slice(0, -1) };
}

function hasMenuContent(node: ReactNode): boolean {
  if (node == null || typeof node === 'boolean') return false;
  if (Array.isArray(node)) return node.some(hasMenuContent);
  if (isValidElement<{ children?: ReactNode }>(node) && node.type === Fragment) {
    return hasMenuContent(node.props.children);
  }
  return Children.toArray(node).some((child) => {
    if (child == null || typeof child === 'boolean') return false;
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) {
      return hasMenuContent(child.props.children);
    }
    return true;
  });
}

/** ⋯ menu for secondary contract actions. Sits to the right of the primary header control. */
export function ContractOverflowMenu({
  children,
  keepMounted = false,
}: {
  children?: ReactNode;
  /**
   * Keep the menu's content mounted while it is closed (hidden). Needed when a row
   * owns its own dialog (Report fraud, Raise dispute): choosing it closes the menu,
   * and an unmounted row would take its just-opened dialog with it.
   */
  keepMounted?: boolean;
}) {
  if (!hasMenuContent(children)) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          data-slot="menu"
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground"
          aria-label="More actions"
        >
          <Icon icon={DotsThreeVerticalIcon} className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-52 p-tight data-[state=closed]:hidden"
        {...(keepMounted ? { forceMount: true as const } : {})}
      >
        <div
          className={cn(
            'flex flex-col',
            // Menu rows, not CTAs. Button CVA is semibold 14px; next to a muted
            // Report that looked like a caption, Cancel read as a heading.
            '[&_a]:h-9 [&_a]:w-full [&_a]:justify-start [&_a]:px-2.5 [&_a]:text-body [&_a]:font-medium [&_a]:text-foreground',
            '[&_button]:h-9 [&_button]:w-full [&_button]:justify-start [&_button]:px-2.5 [&_button]:text-body [&_button]:font-medium',
            // A FILLED BUTTON IS NOT A MENU ROW. Rooms hand this menu their
            // stock controls, and a `destructive` one arrived as a solid red
            // slab spanning the popover — louder than the surface it sat on and
            // nothing like the quiet rows beside it. Selecting on the fill class
            // rather than a variant prop, because the variant is not visible
            // here: the button is somebody else's element by the time it lands.
            // The ink keeps the warning; the slab goes.
            '[&_.bg-destructive]:border-transparent [&_.bg-destructive]:bg-destructive/10 [&_.bg-destructive]:text-destructive hover:[&_.bg-destructive]:bg-destructive/15',
            // A destructive row (Cancel) that arrives as an outline button gets the
            // same soft red fill, without the outline box.
            '[&_button.text-destructive]:border-transparent [&_button.text-destructive]:bg-destructive/10 hover:[&_button.text-destructive]:bg-destructive/15',
            // `default` and `action` both fill with `bg-primary` (ink) now.
            '[&_.bg-primary]:border-transparent [&_.bg-primary]:bg-transparent [&_.bg-primary]:text-foreground hover:[&_.bg-primary]:bg-muted',
            '[&_svg]:size-3.5',
          )}
        >
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The one card in a contract room that says what happens now. */
/**
 * The control column, shared by `card` and `dock`.
 *
 * ALWAYS RIGHT, ALWAYS LAST. `ml-auto` rather than a grid column, so a card with
 * no controls does not reserve an empty gutter, and a set of controls too wide
 * for the row wraps to its own line beneath the text instead of crushing it.
 *
 * The width overrides are here because the rooms pass the SAME children to every
 * appearance. Buttons and links take their natural width and line up on the
 * right; anything else — a shipment form, a saved-card row, the negotiation
 * panel — declares `w-full` and therefore takes the row to itself, which is the
 * correct outcome for a block that was never a button.
 */
function ActionControls({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-snug',
        // `span` joins `a` and `button` as natural-width: a short status word
        // beside the controls ("Reviewed") is not a block.
        '[&>*]:w-full [&>a]:w-auto [&>button]:w-auto [&>span]:w-auto',
        // `ActionBar` renders its own flex row of buttons and marks it
        // `role="group"`. Targeted by that role rather than by element, so this
        // cannot accidentally bottom-align a panel that happens to be a flex
        // column.
        '[&>[role=group]]:justify-end',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ContractActionCard({
  step,
  title,
  detail,
  note,
  tone = 'default',
  children,
  more,
  appearance = 'card',
  waitingFor,
  className,
}: ContractActionCardProps) {
  const viewersMove = isViewersMove(step);
  const yourMove = viewersMove && tone === 'default';
  if (appearance === 'header') {
    return (
      <div
        aria-live="polite"
        className={cn('flex w-full items-center justify-end gap-1.5', className)}
      >
        <h3 className="sr-only">
          {title ?? step?.label ?? 'This contract is finished'}
        </h3>
        {children ? (
          <div
            className={cn(
              'flex min-w-0 flex-1 flex-wrap items-center justify-stretch gap-tight md:flex-none md:justify-end',
              '[&>*]:w-auto [&>a]:min-h-10 [&>button]:min-h-10 [&>button]:px-cozy',
              '[&_a]:min-h-10 [&_a]:px-cozy [&_a]:text-body [&_button]:min-h-10 [&_button]:w-auto [&_button]:px-cozy [&_button]:text-body',
              'lg:[&>a]:h-8 lg:[&>a]:min-h-8 lg:[&>button]:h-8 lg:[&>button]:min-h-8 lg:[&>button]:px-cozy',
              'lg:[&_a]:h-8 lg:[&_a]:min-h-8 lg:[&_a]:px-cozy lg:[&_button]:h-8 lg:[&_button]:min-h-8 lg:[&_button]:px-cozy',
              '[&_svg]:size-3.5',
            )}
          >
            {children}
          </div>
        ) : null}
        <ContractOverflowMenu>{more}</ContractOverflowMenu>
      </div>
    );
  }
  if (appearance === 'dock') {
    const { blocks, primary, rest } = splitPrimary(children);
    const menu = rest.length > 0 ? <>{rest}{more}</> : more;
    // THE STEP'S NAME, THE SAME ONE THE PROGRESS STRIP AND RAIL SHOW (2026-11-27).
    // The buttons say what to do; the title says which step this is. On the other
    // side's move there are no buttons, so it says who it is waiting for. The full
    // label ("Waiting for Ada to pay") heads the (i).
    const stepName = step ? (step.short ?? step.label) : null;
    const waiting =
      !title && step?.status === 'active' && step.owner === 'them' && waitingFor
        ? `Waiting for ${waitingFor}`
        : null;
    const label = title ?? stepName ?? 'This contract is finished';
    const fullLabel = !title && step && step.label !== stepName ? step.label : null;
    const explanation = detail ?? step?.detail;
    // AN OUTCOME IS SAID, NOT HIDDEN. On a step the viewer acts on, the sentence only
    // explains the button, so it waits behind the (i). On an outcome ("The payment could
    // not be collected, so the item returned to the catalog", a refund, a dispute), the
    // sentence IS the news, so it is printed under the title, two lines at most.
    const outcome = tone !== 'default';
    const sentence =
      (fullLabel || explanation) && !outcome ? (
        <>
          {fullLabel ? <span className="mb-tight block font-semibold text-foreground">{fullLabel}</span> : null}
          {explanation}
        </>
      ) : null;
    return (
      <section
        aria-live="polite"
        className={cn('px-cozy py-snug', yourMove ? YOUR_MOVE_STRIP : STRIP_TONE[tone], className)}
      >
        {/* ONE ROW: what to do on the left, the button on the right, ⋯ last.

            No "Your move" pill: the violet edge and wash already say the step is
            the viewer's, and the button is the instruction itself.

            The title wraps to a second line rather than truncating. The sentence explaining the step
            is not printed: it ran to two or five lines depending on its length and
            the column's width, so the band changed height from step to step. It
            sits behind the (i) beside the title instead, where any length fits.

            `min-h-10 md:min-h-9` holds the row at the button's height on every
            step, with or without a button, so the conversation above never moves
            when the contract's state arrives over Realtime. */}
        {blocks.length > 0 ? <div className="mb-snug space-y-snug">{blocks}</div> : null}
        {/* ONE ROW WHEN IT FITS, TWO WHEN IT DOES NOT. One button sits beside the
            title. A set of them (accept, dispute, fraud) is wider than the chat
            column allows beside a readable title, so it wraps onto its own line
            under the title instead of squeezing the title to "Ac… w…" or running
            off the edge on a phone (UX review 2026-11-26). The title keeps a 9rem
            floor, which is what forces the wrap. */}
        <div className="flex min-h-10 min-w-0 flex-wrap items-center gap-x-cozy gap-y-snug md:min-h-9">
          {/* WRAPS, NEVER CUTS OFF. A truncated title ("Set handover t…") hid
              the one thing the row is for. It may take two lines, and the (i)
              rides inline after the last word instead of claiming its own
              column. Two lines at most (`line-clamp-2`); the short titles are
              written to fit one. */}
          {/* THE OUTCOME SENTENCE SITS UNDER THE TITLE, in the same column
              (2026-11-27). It was a paragraph below the whole row, so a dispute's
              title, its button and its one-line explanation took three bands of
              height, with the sentence pushed under the button. */}
          <div className="min-w-[9rem] flex-1">
          <h3 className="line-clamp-2 text-pretty text-body font-semibold leading-snug">
            {label}
            {/* Spaced, not dotted (2026-11-27). */}
            {waiting ? (
              <span className="ml-cozy font-normal text-muted-foreground">{waiting}</span>
            ) : null}
            {sentence ? (
              <span className="ml-1 inline-flex align-middle">
                <StepInfo>{sentence}</StepInfo>
              </span>
            ) : null}
          </h3>
          {outcome && explanation ? (
            <p className="line-clamp-2 text-meta text-muted-foreground">{explanation}</p>
          ) : null}
          {note ? <p className="line-clamp-1 text-meta text-muted-foreground">{note}</p> : null}
          </div>

          {primary || hasMenuContent(menu) ? (
            <div className="ml-auto flex min-w-0 max-w-full items-center gap-x-tight [&>[data-slot=menu]]:-my-2.5 md:[&>[data-slot=menu]]:my-0">
              {primary ? (
                // COMPACT, NOT TINY (UX review 2026-11-26). Three 40px / 36px buttons
                // side by side were the heaviest thing in the room. 36px on a phone
                // keeps a comfortable touch target, 32px from `md` matches the
                // header's controls, 13px type and 14px icons keep the labels easy
                // to read, and a slightly wider gap keeps them separate choices.
                // NATURAL WIDTH ON A PHONE TOO (2026-11-27). Stretching the set to
                // fill the row made a full-width slab of the primary; the buttons
                // keep their own size, right-aligned, on one line, beside the
                // title when they fit and under it when they do not.
                <ActionControls className="gap-2 [&_a]:h-8 [&_button]:h-8 [&_button]:px-3 [&_a]:px-3 [&_a]:text-[0.8125rem] [&_button]:text-[0.8125rem] [&_svg]:size-3.5 [&_[role=group]]:gap-2 [&_[role=group]]:flex-nowrap [&_[role=group]>*]:shrink-0">

                  {primary}
                </ActionControls>
              ) : null}
              <ContractOverflowMenu keepMounted={rest.length > 0}>{menu}</ContractOverflowMenu>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <Card className={cn(yourMove ? YOUR_MOVE_CARD : TONE[tone], className)}>
      {/* Same three-line contract as the dock, one step roomier: the banner
          spans the page rather than a chat column, so the detail gets two lines
          before it clamps. Flex-wrap rather than a two-column grid — a grid
          reserved the control gutter even when the card had no controls, and
          forced a wide control block to live in a narrow column instead of
          taking a row of its own. */}
      <CardContent className="flex flex-wrap items-center gap-x-group gap-y-cozy p-group">
        <div className="min-w-0 flex-1 basis-72">
          <h3 className="text-pretty text-subhead font-semibold leading-tight tracking-tight">
            {viewersMove ? <YourMovePill /> : null}
            {title ?? step?.label ?? 'This contract is finished'}
          </h3>
          {detail ?? step?.detail ? (
            <p className="mt-tight line-clamp-2 max-w-3xl text-body text-muted-foreground">
              {detail ?? step?.detail}
            </p>
          ) : null}
          {note ? (
            <p className="mt-tight line-clamp-1 text-meta text-muted-foreground">
              {note}
            </p>
          ) : null}
        </div>

        {children ? (
          <ActionControls className="md:max-w-[40rem]">{children}</ActionControls>
        ) : null}
      </CardContent>
    </Card>
  );
}
