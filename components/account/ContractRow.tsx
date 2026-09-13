// components/account/ContractRow.tsx
//
// The parts a contract list row is built from, shared by Purchases, Sales and Trades.
//
// WHY THE THREE LISTS SHARE A GRID. They are the same instrument pointed at three
// tables: a thumbnail, what the contract is about, whose move it is, and where it has
// got to. Each one used to lay its row out with its own flex rules, so the status badge
// landed at a different x on `/sales` than on `/trades` — and within one list, at a
// different x on every row, because a flex row sizes its cells from its own content.
// `CONTRACT_ROW_GRID` is declared once and applied to the header and every row, which
// is the whole reason a column exists to run your eye down.
//
// WHY A ROW SAYS WHAT TO DO AND NOT JUST WHERE IT IS. A status badge names the STATE.
// `ESCROW_HELD` is a true and useless thing to tell a seller who wants to know whether
// to go to the post office. The next-move cell names the MOVE, and it does it in the
// derivation's own words — see `ContractNextMove` in `lib/actions/account.ts` for why
// there is no second copy of that copy.

import { HugeiconsIcon } from '@hugeicons/react';
import { ImageOffIcon } from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import { EmptyState } from '@/components/ui/empty-state';
import type { ContractNextMove } from '@/lib/actions/account';
import { itemImageUrl } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * THE ONE COLUMN DEFINITION for a contract row. Header and rows both apply it.
 *
 * TWO columns on a phone — thumbnail, then everything else. It was three, with the
 * status badge in an `auto` track, and that was wrong in two compounding ways. `auto`
 * sizes to the row's OWN content and badge labels differ in length, so "Funds
 * confirmed" stole more width than "Inspection" and the titles beside them truncated at
 * different points down the list: `Weiss Schwar…` against `Monkey D. Luffy …`. The badge
 * was also vertically centred against a three-line block, so it floated in the middle
 * of the row attached to nothing.
 *
 * At 390px the title is what a member is scanning, so it gets the full width and the
 * badge moves into the content block beside the price. From `md` the badge has its own
 * fixed 9rem column again, where the room exists.
 *
 * Desktop-only cells are `hidden`, which removes them from grid flow entirely so the
 * template still matches the number of visible cells at each breakpoint.
 */
export const CONTRACT_ROW_GRID =
  'grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-cozy ' +
  'md:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1.1fr)_9rem]';

/**
 * A 48px (56px from `md`) cover for a contract row.
 *
 * `alt=""` because the contract's title is immediately beside it: announcing the photo
 * would read the same name twice. `children` is the fallback for a row that has no
 * photo to show — a trade, whose subject is two sides rather than one object.
 */
export function ContractRowThumb({
  imagePath,
  children,
}: {
  /** Storage object path from the contract's own snapshot, not the live item row. */
  imagePath?: string | null;
  /** Drawn when there is no image. Defaults to a muted "no photo" glyph. */
  children?: ReactNode;
}) {
  const url = itemImageUrl(imagePath ?? null);

  return (
    <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-muted text-muted-foreground md:size-14">
      {url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={url} alt="" className="size-full object-cover" loading="lazy" draggable={false} />
      ) : (
        (children ?? (
          <>
            <HugeiconsIcon icon={ImageOffIcon} className="size-5" aria-hidden />
            <span className="sr-only">No image available</span>
          </>
        ))
      )}
    </span>
  );
}

/**
 * Whether a contract is waiting on the person reading the list.
 *
 * `both` counts as yours. A step either side may take is a step YOU can take, and
 * filing it under "waiting" would hide the one contract a member could unblock right
 * now. `platform` does not: a dispute under review or a payout in the queue is nobody's
 * move, and telling a member to act on it would be a lie with a deadline attached.
 */
export function needsViewer(move: ContractNextMove | null): boolean {
  return move !== null && (move.owner === 'you' || move.owner === 'both');
}

/**
 * The next-move cell.
 *
 * NO OWNER PILL BESIDE THE TEXT, and that is not an omission. The derivation's labels
 * already name their actor in words — "Waiting for Sarah to post it", "Post it and add
 * the tracking number" — so a "Waiting" chip in front of the first one says it twice.
 * The owner survives as TONE: a move that is yours gets an amber marker and full
 * contrast, one that is not stays muted. Same information, read faster, said once.
 */
export function NextMoveCell({
  move,
  className,
}: {
  move: ContractNextMove | null;
  className?: string;
}) {
  if (!move) {
    // A finished contract is not waiting on anything. An em dash rather than blank so
    // the column still reads as a column, and `aria-hidden` so a screen reader is not
    // told "dash" once per settled row.
    return (
      <span className={cn('text-meta text-muted-foreground', className)} aria-hidden="true">
        —
      </span>
    );
  }

  const mine = needsViewer(move);

  return (
    <span
      className={cn(
        'flex min-w-0 items-start gap-tight text-meta',
        mine ? 'font-medium text-foreground' : 'text-muted-foreground',
        className,
      )}
    >
      {mine ? (
        // `action-edge` rather than `action`: the amber fill is a background colour and
        // reads as a pale smudge at 6px. The border token is the same hue dark enough
        // to be a mark. `mt-1` optically centres it on the first line of a clamped
        // label rather than on the box.
        <span
          className="mt-1 inline-block size-1.5 shrink-0 rounded-full bg-action-edge"
          aria-hidden="true"
        />
      ) : null}
      <span className="line-clamp-2">{move.label}</span>
    </span>
  );
}

/**
 * What to show when a whose-move filter matched nothing.
 *
 * A FILTER THAT MATCHED NOTHING IS NOT AN EMPTY ACCOUNT, and that distinction is the
 * whole reason this exists. While a contract section had only Active and Past, anything
 * but Past could safely offer "list your first item" — now a seller with six live
 * contracts can land on an empty page simply because none of them are waiting on them,
 * and inviting them to create another would be answering a question they did not ask.
 *
 * Returns null for `active`, where the list's own empty state — the one with a call to
 * action — is the right answer.
 */
export function ContractScopeEmptyState({
  scope,
  noun,
}: {
  scope: 'active' | 'needs-you' | 'waiting' | 'past';
  /** Plural, lower case: "sales", "purchases", "trades". */
  noun: string;
}) {
  if (scope === 'active') return null;

  const copy = {
    'needs-you': {
      title: 'Nothing Waiting On You',
      description: `Every one of your open ${noun} is with the other party right now.`,
    },
    waiting: {
      title: 'Nothing Waiting On Anyone Else',
      description: `None of your open ${noun} are sitting with the other party.`,
    },
    past: {
      title: 'Nothing Finished Yet',
      description: `Completed and cancelled ${noun} are kept here.`,
    },
  }[scope];

  return (
    <EmptyState title={copy.title} description={copy.description} compact fill />
  );
}

/**
 * The frame all three contract lists sit in: one bordered card, a desktop header row,
 * and hairline-divided rows inside it.
 *
 * The header is hidden below `md`, where the cells it labels are folded into the middle
 * cell and a header would be naming columns that are not there.
 *
 * @param subject What the first wide column holds — "Item" for a sale, "Trade" for a
 *   swap. The other two headings are the same on every list, which is the point.
 */
export function ContractRowTable({
  subject,
  label,
  children,
}: {
  subject: string;
  /** Accessible name for the list, e.g. "Your sales". */
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div
        className={cn(
          CONTRACT_ROW_GRID,
          'hidden border-b border-border bg-muted px-group py-snug md:grid',
        )}
        aria-hidden="true"
      >
        <span />
        <span className="market-label text-muted-foreground">{subject}</span>
        <span className="market-label text-muted-foreground">Next step</span>
        <span className="market-label text-right text-muted-foreground">Status</span>
      </div>
      <ul role="list" aria-label={label} className="divide-y divide-border">
        {children}
      </ul>
    </div>
  );
}
