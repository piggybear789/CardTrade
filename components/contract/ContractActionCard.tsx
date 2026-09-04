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
// The step label answers ownership in words — "Waiting for the other party to
// join" — so the card carries no eyebrow or owner badge. When it is not the
// viewer's move, the room passes no children and the card deliberately shows no
// buttons.

import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { MoreVerticalIcon } from '@hugeicons/core-free-icons';

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

const TONE: Record<ContractActionTone, string> = {
  default: 'border-iris/40 bg-iris/[0.08]',
  success: 'border-[hsl(var(--trust)/0.4)] bg-[hsl(var(--trust)/0.06)]',
  warning: 'border-iris/40 bg-iris/[0.06]',
  danger: 'border-destructive/40 bg-destructive/[0.06]',
};

// The dock is a flat strip inside the chat panel, so it tints only — the
// panel's own border rules divide it from the header and the log.
const STRIP_TONE: Record<ContractActionTone, string> = {
  default: 'bg-iris/[0.08]',
  success: 'bg-[hsl(var(--trust)/0.06)]',
  warning: 'bg-iris/[0.06]',
  danger: 'bg-destructive/[0.06]',
};

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
  className?: string;
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
export function ContractOverflowMenu({ children }: { children?: ReactNode }) {
  if (!hasMenuContent(children)) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          data-slot="menu"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0 text-muted-foreground md:size-7"
          aria-label="More actions"
        >
          <HugeiconsIcon icon={MoreVerticalIcon} className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1">
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
            '[&_.bg-destructive]:border-transparent [&_.bg-destructive]:bg-transparent [&_.bg-destructive]:text-destructive hover:[&_.bg-destructive]:bg-destructive/10',
            '[&_.bg-action]:border-transparent [&_.bg-action]:bg-transparent [&_.bg-action]:text-foreground hover:[&_.bg-action]:bg-muted',
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
  className,
}: ContractActionCardProps) {
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
              'flex min-w-0 flex-1 flex-wrap items-center justify-stretch gap-1 md:flex-none md:justify-end',
              '[&>*]:w-auto [&>a]:min-h-10 [&>button]:min-h-10 [&>button]:px-3',
              '[&_a]:min-h-10 [&_a]:px-3 [&_a]:text-body [&_button]:min-h-10 [&_button]:w-auto [&_button]:px-3 [&_button]:text-body',
              'lg:[&>a]:h-7 lg:[&>a]:min-h-7 lg:[&>button]:h-7 lg:[&>button]:min-h-7 lg:[&>button]:px-2.5',
              'lg:[&_a]:h-7 lg:[&_a]:min-h-7 lg:[&_a]:px-2.5 lg:[&_button]:h-7 lg:[&_button]:min-h-7 lg:[&_button]:px-2.5',
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
    return (
      <section
        aria-live="polite"
        className={cn('px-cozy py-snug', STRIP_TONE[tone], className)}
      >
        {/* ONE ROW, THREE LINES AT MOST. Text left, controls right, ⋯ last.
            This was a stack — title, detail, tracking string, then a button on
            its own row — which ran to five lines in a band that is pinned over
            the conversation for the entire contract. Every line it spends is a
            line of the conversation it covers.

            `flex-wrap` is what keeps it honest at narrow widths: the text block
            holds a 14rem basis, so a wide control set drops to its own line
            rather than squeezing the sentence into a column of single words.

            `-my-2.5` on the menu, phone only. The ⋯ is a 44px touch target
            against a 20px title line, so it was setting the row height. It is a
            transparent ghost icon at the far right, so letting it overflow its
            own row is invisible — the hit area is unchanged and there is
            nothing beside it to collide with. */}
        <div className="flex flex-wrap items-center gap-x-cozy gap-y-snug [&>[data-slot=menu]]:-my-2.5 md:[&>[data-slot=menu]]:my-0">
          {/* `basis-0` ON A PHONE, `basis-56` from `md`. A 14rem basis is the
              right wrap threshold on a desktop dock, and on a 390px screen it
              was wider than what remained beside the button — so the row wrapped
              every time and the control dropped to a line of its own, which is
              the stacked layout this card exists to avoid. At `basis-0` the text
              takes whatever the button leaves and truncates, so title and
              control stay on one row until the control genuinely cannot fit. */}
          <div className="min-w-0 flex-1 basis-0 md:basis-56">
            {/* Two lines on a phone, one from `md`. The detail is hidden below
                `md`, so the title can afford the second line there and still
                keep the band inside its three-line budget; on desktop the
                detail is showing and the title has to give the line back. */}
            {/* A step may carry a subject-less `compactLabel` for this width
                only — "Confirm item" for "Buyer confirms the item". Both spans
                render and CSS picks one, rather than branching on a media
                query in JS: the dock is server-rendered and a hook would flash
                the wrong title on first paint. A `title` override wins outright,
                since a flow that supplied its own copy has already decided. */}
            <h3 className="line-clamp-2 text-lead font-semibold leading-tight tracking-tight md:line-clamp-1">
              {title ?? (
                step?.compactLabel ? (
                  <>
                    <span className="md:hidden">{step.compactLabel}</span>
                    <span className="hidden md:inline">{step.label}</span>
                  </>
                ) : (
                  step?.label ?? 'This contract is finished'
                )
              )}
            </h3>
            {/* DESKTOP ONLY IN THE DOCK. On a phone this band is pinned over
                the conversation for the whole trade, and the sentence is
                consistently the title restated with the button label appended —
                "Both traders post with tracking" over "Post your item and
                record the carrier and tracking number", above a button reading
                "Record shipment". The desktop dock is a strip in its own column
                and has the room. Clamped to one line either way. */}
            {detail ?? step?.detail ? (
              <p className="mt-0.5 hidden line-clamp-1 text-body text-muted-foreground md:block">
                {detail ?? step?.detail}
              </p>
            ) : null}
            {note ? (
              <p className="mt-0.5 line-clamp-1 text-meta text-muted-foreground">
                {note}
              </p>
            ) : null}
          </div>

          {children ? (
            // 40px on a phone, compacting from `md` — the Button default at
            // both widths. These are the room's primary actions ("Record
            // shipment", "Item never arrived") and must not drop to the desktop
            // size on touch, which is what this override is guarding against.
            <ActionControls className="[&_a]:h-10 [&_button]:h-10 [&_button]:px-3 md:[&_a]:h-8 md:[&_button]:h-8">
              {children}
            </ActionControls>
          ) : null}

          <ContractOverflowMenu>{more}</ContractOverflowMenu>
        </div>
      </section>
    );
  }

  return (
    <Card className={cn(TONE[tone], className)}>
      {/* Same three-line contract as the dock, one step roomier: the banner
          spans the page rather than a chat column, so the detail gets two lines
          before it clamps. Flex-wrap rather than a two-column grid — a grid
          reserved the control gutter even when the card had no controls, and
          forced a wide control block to live in a narrow column instead of
          taking a row of its own. */}
      <CardContent className="flex flex-wrap items-center gap-x-group gap-y-cozy p-group">
        <div className="min-w-0 flex-1 basis-72">
          <h3 className="text-pretty text-subhead font-semibold leading-tight tracking-tight">
            {title ?? step?.label ?? 'This contract is finished'}
          </h3>
          {detail ?? step?.detail ? (
            <p className="mt-1 line-clamp-2 max-w-3xl text-body text-muted-foreground">
              {detail ?? step?.detail}
            </p>
          ) : null}
          {note ? (
            <p className="mt-1 line-clamp-1 text-meta text-muted-foreground">
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
