// lib/notifications/linkedContract.ts
//
// What a notification's linked sale or trade says the row is about (2026-11-28).
//
// The 0126 context columns (the card, its photo, the other member) are filled by 21 of
// the 76 places that raise a notification in TypeScript and by none of the database
// jobs, so four "Inspection window closing" rows on four different trades read as one
// line four times. The contract the row links to knows the answer, and
// `listMyNotifications` already reads it to decide whether the link still opens, so a
// row that names no subject of its own takes its contract's. That also covers rows
// raised before this, and every producer added later without context.
//
// This module is the pure half: reading the link and choosing what to fill. The reads
// are in `lib/actions/notifications.ts`. No server imports, so the realtime hook can
// use `parseContractLink` to spot a live row worth describing.

import type { ContractStepOwner } from '@/domain/contract';

/** `/sales/<uuid>` or `/trades/<uuid>`, optionally followed by a path, query or hash. */
const CONTRACT_LINK = /^\/(sales|trades)\/([0-9a-f-]{36})(?:[/?#]|$)/i;

/** The contract a notification links to. */
export interface ContractLink {
  kind: 'sale' | 'trade';
  /** The contract id, lower-cased. */
  id: string;
}

/** The sale or trade a notification's `link` opens, or `null` for any other link. */
export function parseContractLink(link: string | null | undefined): ContractLink | null {
  const match = link ? CONTRACT_LINK.exec(link) : null;
  if (!match) return null;
  return {
    kind: match[1].toLowerCase() === 'sales' ? 'sale' : 'trade',
    id: match[2].toLowerCase(),
  };
}

/**
 * What the linked contract is waiting on NOW, for the person reading the row: the live
 * step of its plan, from the same derivation the contract room and the contract lists
 * use (`currentStep` over `cashSaleStepsForRow` / `tradeStepsForRow`). `null` once the
 * contract is over, or when the reader is not a party to it.
 *
 * Derived, never guessed from the notification's title: a row about a trade that has
 * since completed asks for nothing, whatever its title said at the time.
 */
export interface ContractMove {
  /** `you`, `them`, `both` or `platform`. */
  owner: ContractStepOwner;
  /** The step, in the derivation's own words ("Accept what you received"). */
  label: string;
}

/** What one contract is about, as its own row and its embeds say. */
export interface ContractSubject {
  /**
   * A sale's frozen item title, or the title of the listing a trade was opened on (the
   * counterpart's card, the one `tradeContext` names).
   */
  title: string | null;
  /** The matching cover photo, an item-images object path. */
  imagePath: string | null;
  /** Each party's PUBLIC display name by profile id; `null` for a closed account. */
  participants: ReadonlyMap<string, string | null>;
}

/** The row fields a contract can fill. */
export interface SubjectFields {
  subject_title: string | null;
  image_path: string | null;
  actor_name: string | null;
}

/** A value worth keeping: present and not blank. */
function present(value: string | null | undefined): string | null {
  return value && value.trim() ? value : null;
}

/**
 * The row's subject fields, with any its producer left empty filled from its contract.
 *
 * - The producer's own values always win, field by field.
 * - The other member is named only when the recipient is one of the contract's two
 *   parties, so a staff member's row about someone else's sale names nobody.
 * - NEVER AN AMOUNT. A contract's price is not the figure a payout, refund or fee row
 *   is about, so a row shows money only when its producer stated it.
 */
export function subjectFields(
  row: { user_id: string } & SubjectFields,
  subject: ContractSubject | undefined,
): SubjectFields {
  let other: string | null = null;
  if (subject?.participants.has(row.user_id)) {
    for (const [id, name] of subject.participants) {
      if (id !== row.user_id) other = present(name);
    }
  }
  return {
    subject_title: present(row.subject_title) ?? present(subject?.title),
    image_path: present(row.image_path) ?? present(subject?.imagePath),
    actor_name: present(row.actor_name) ?? other,
  };
}
