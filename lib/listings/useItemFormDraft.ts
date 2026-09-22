'use client';

// lib/listings/useItemFormDraft.ts
//
// Keeps a half-written listing alive across a navigation away from the form.
//
// ── THE REPORT THIS EXISTS FOR ────────────────────────────────────────────────
//
//     "my listing should've been saved as a draft even if i wasn't verified yet / coz i had
//      to go back and fill in the same fields 5 times while i was trying to figure out how
//      to resolve the error message"
//
// `ItemForm` holds its state in `useState`, which survives a failed submit perfectly well —
// nothing remounts or redirects on `{ ok: false }`. What it does not survive is the member
// LEAVING to go and fix whatever the error complained about. The form's `beforeunload`
// handler does not fire on a client-side navigation, so following the error's own "Open
// verification" link silently discarded everything they had typed, and coming back rendered
// an empty form. Every round trip cost them the whole form again.
//
// ── WHY sessionStorage, AND WHY NOT A `DRAFT` ITEM STATUS ─────────────────────
//
// The member asked for a draft, and a real draft row is the wrong tool for this job. It
// would mean a fourth value in `item_status` (`AVAILABLE | RESERVED | SOLD` today), which
// every catalog query, RLS policy, orchestrator union and the three `ItemStatus` copies in
// `domain/` would have to learn to exclude — and a row that is deliberately invisible to
// buyers is exactly the kind of thing that leaks into a catalog select later. It also means
// writing a row for a member the gate has just refused, which is the opposite of what the
// gate is for.
//
// The actual problem is narrower than "drafts": the input needs to survive a two-minute
// detour in the same tab. `sessionStorage` is scoped to the tab and dies with it, which
// matches the lifetime of the detour. `localStorage` would leave a half-written listing on
// a shared machine indefinitely.
//
// If drafts-as-a-feature is wanted later — visible on `/listings/mine`, resumable next week,
// on another device — that is a schema change and a product decision, and this hook is not
// a substitute for it. It is the fix for losing work mid-session.
//
// ── WHAT IS DELIBERATELY NOT PERSISTED ────────────────────────────────────────
//
// The selected photos. They are `File` handles, which do not survive serialisation; keeping
// them would mean copying the bytes into IndexedDB, which is a materially bigger change and
// carries its own eviction and quota behaviour. So a member who leaves and returns finds
// their text intact and re-picks their images, and `ItemForm` says so rather than leaving
// them to notice. Honest and partial beats silent and total.

import * as React from 'react';

/** Bump when the shape below changes, so a stale payload is discarded rather than read. */
const DRAFT_VERSION = 1;

/** One key for the create form. Edit mode does not use this hook — see `useItemFormDraft`. */
const STORAGE_KEY = 'nd.listing.draft.v1';

/** How long to wait after the last keystroke before writing. */
const WRITE_DEBOUNCE_MS = 400;

/**
 * The serialisable half of the create form.
 *
 * `location` is a `PlaceValue`, which is plain JSON — it is the resolved place, not the
 * Places response, so restoring it does not re-hit the provider and does not need a key.
 */
export interface ItemFormDraft {
  version: number;
  description: string;
  game: string;
  condition: string;
  listingKind: string;
  fmvDollars: string;
  location: unknown;
}

/** The fields a caller supplies and gets back. `version` is this module's business. */
export type ItemFormDraftFields = Omit<ItemFormDraft, 'version'>;

/** True when a draft holds anything worth restoring. */
function isWorthKeeping(fields: ItemFormDraftFields): boolean {
  return (
    fields.description.trim() !== '' ||
    fields.fmvDollars.trim() !== '' ||
    fields.condition !== '' ||
    fields.location != null
  );
}

/** Read a stored draft, or `null`. Never throws. */
function readDraft(): ItemFormDraftFields | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<ItemFormDraft>;
    // A payload from an older build is discarded rather than coerced. Restoring a listing
    // form from a shape that no longer matches is how a member ends up with a condition
    // that is no longer on the list, silently.
    if (parsed.version !== DRAFT_VERSION) return null;

    return {
      description: typeof parsed.description === 'string' ? parsed.description : '',
      game: typeof parsed.game === 'string' ? parsed.game : '',
      condition: typeof parsed.condition === 'string' ? parsed.condition : '',
      listingKind: typeof parsed.listingKind === 'string' ? parsed.listingKind : 'SINGLE',
      fmvDollars: typeof parsed.fmvDollars === 'string' ? parsed.fmvDollars : '',
      location: parsed.location ?? null,
    };
  } catch {
    // Malformed JSON, or storage blocked. A lost draft is a nuisance; a thrown error on
    // mount would be a blank page where the form should be.
    return null;
  }
}

/** Remove any stored draft. Safe to call when there is none. */
export function clearItemFormDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do. The draft expires with the tab regardless.
  }
}

/**
 * Persist the create form's text fields to `sessionStorage`, debounced.
 *
 * CREATE MODE ONLY, and the caller must not pass `enabled` in edit mode. An edit form is
 * already backed by a row, so a stored draft would introduce a genuine conflict — is the
 * draft newer than the row, or is it left over from a session before someone else changed
 * the listing? — that has no safe default. Losing unsaved edits is a smaller problem than
 * silently resurrecting stale ones over a row.
 *
 * @param fields  The current values. Written after {@link WRITE_DEBOUNCE_MS} of quiet.
 * @param enabled Pass `false` to disable entirely (edit mode, or while submitting).
 */
export function useItemFormDraft(fields: ItemFormDraftFields, enabled: boolean): void {
  // SERIALISE OUTSIDE THE EFFECT AND DEPEND ON THE STRING, not on `fields`.
  //
  // Callers pass an object literal, so `fields` has a fresh identity on every render. As an
  // effect dependency that re-runs the effect — and therefore restarts the debounce — on
  // every render of the parent, including renders that changed nothing here. A string
  // changes only when the content does, so the timer is reset by typing rather than by
  // re-rendering. The payload has to be built anyway, so this costs nothing extra.
  const payload = JSON.stringify({
    version: DRAFT_VERSION,
    ...fields,
  } satisfies ItemFormDraft);
  const worthKeeping = isWorthKeeping(fields);

  React.useEffect(() => {
    if (!enabled) return;

    // An empty form must CLEAR rather than write. Otherwise clearing the fields by hand
    // would leave the previous draft in storage, and the next visit would restore input the
    // member had just deleted.
    if (!worthKeeping) {
      clearItemFormDraft();
      return;
    }

    const handle = window.setTimeout(() => {
      try {
        window.sessionStorage.setItem(STORAGE_KEY, payload);
      } catch {
        // Quota, or private-mode storage. Not worth surfacing: the form still works, and
        // the only loss is the safety net.
      }
    }, WRITE_DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
  }, [payload, worthKeeping, enabled]);
}

/**
 * The draft present at mount, read exactly once.
 *
 * READ IN A `useRef` INITIALISER, NOT AN EFFECT, so the form's `useState` can seed itself
 * from it on the first render. Restoring in an effect instead would render an empty form and
 * then populate it, which flashes, moves focus, and — because the fields are controlled —
 * fights anything the member typed in between.
 *
 * Returns `null` on the server and on any render after the first.
 */
export function useInitialItemFormDraft(enabled: boolean): ItemFormDraftFields | null {
  const initial = React.useRef<ItemFormDraftFields | null | undefined>(undefined);
  if (initial.current === undefined) {
    initial.current = enabled ? readDraft() : null;
  }
  return initial.current;
}
