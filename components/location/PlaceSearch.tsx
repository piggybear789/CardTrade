'use client';

// components/location/PlaceSearch.tsx
//
// Worldwide address autocomplete. Four separate bugs used to compound here into a
// control that felt broken; each fix is marked below so none of them gets undone:
//
//   1. The spinner shared one `transform` between `-translate-y-1/2` and
//      `animate-spin`. Tailwind's spin keyframes set `transform: rotate(...)`,
//      which REPLACES the translate for the whole animation, so the icon dropped
//      out of the field the moment it started spinning. Rotation and positioning
//      now live on different elements.
//   2. `setLoading(false)` sat inside an `if (!aborted)` guard. Every keystroke
//      aborts, so the guard skipped the reset and the spinner could run forever.
//      Loading is now keyed to the latest request id, which cannot be skipped.
//   3. `setLoading(true)` was inside the debounce timer, so nothing acknowledged a
//      keystroke for 250ms. It is now set synchronously on input.
//   4. The search effect depended on `value` (an object), so any parent re-render
//      passing a fresh object aborted the in-flight request and restarted the
//      debounce. It now depends on `value?.placeId`.
//
// It also used to be impossible to CHANGE a selected place: a sync effect rewrote
// the input back to the selected label, the search early-returned while the text
// matched that label, and the parent only cleared the selection on empty text. Any
// edit now counts as intent to re-search, and there is an explicit clear button.

import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, MapPin, X } from 'lucide-react';

import { searchPlaces } from '@/lib/location/googleMaps';
import type { PlacePrecision, PlaceValue } from '@/lib/location/types';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface PlaceSearchProps {
  precision: PlacePrecision;
  value: PlaceValue | null;
  onSelect: (place: PlaceValue) => void;
  /** Clear the current selection. */
  onClear?: () => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  className?: string;
  /**
   * Restrict results to these ISO 3166-1 alpha-2 countries. Omit for worldwide.
   * If you pass this, say so in the visible copy — a silently empty dropdown is
   * indistinguishable from an outage.
   */
  countries?: string[];
  /** Rank this country's results first without excluding others. */
  biasCountry?: string | null;
  /** Called on free-text input, so the parent can drop a stale selection. */
  onTextFallback?: (label: string) => void;
}

/** Tallest the suggestion list renders: `max-h-56` (14rem) plus its 4px gap. */
const LIST_MAX_HEIGHT = 228;

/**
 * The viewport-relative box the suggestion list can occupy without being cut off.
 *
 * The nearest ancestor with a non-`visible` overflow is what clips an absolutely
 * positioned descendant, so that box — intersected with the viewport — is the real
 * budget. Falls back to the viewport when nothing on the way up clips.
 */
function clippingBounds(el: HTMLElement): { top: number; bottom: number } {
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (style.overflowY !== 'visible' || style.overflowX !== 'visible') {
      const rect = node.getBoundingClientRect();
      return {
        top: Math.max(0, rect.top),
        bottom: Math.min(window.innerHeight, rect.bottom),
      };
    }
  }
  return { top: 0, bottom: window.innerHeight };
}

export function PlaceSearch({
  precision,
  value,
  onSelect,
  onClear,
  placeholder = 'Search for a place',
  disabled,
  id,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  className,
  countries,
  biasCountry,
  onTextFallback,
}: PlaceSearchProps) {
  const listId = useId();
  const [query, setQuery] = useState(value?.label ?? '');
  const [results, setResults] = useState<PlaceValue[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // Why the list is empty. An empty dropdown used to be the ONLY symptom of a
  // provider outage, a missing API enablement, and a query with genuinely no
  // matches — and of a CSP that omitted `places.googleapis.com`, which is how this
  // field once read as "not wired" while working exactly as written.
  const [outcome, setOutcome] = useState<'none' | 'empty' | 'error'>('none');
  const abortRef = useRef<AbortController | null>(null);
  // Monotonic request id. Only the newest request may write state, which makes the
  // loading reset unconditional instead of depending on an abort signal.
  const requestIdRef = useRef(0);
  // Serialised so an inline `countries={['AU']}` at a call site cannot restart the
  // debounce on every parent render — the same object-identity trap that `value`
  // used to have. Depend on the string, read the array.
  const countryKey = countries?.join(',') ?? '';
  // True while the user is typing. Blocks the sync-from-props effect below from
  // overwriting their edit, which is what made a selection unchangeable.
  const editingRef = useRef(false);

  /**
   * Pending `setOpen(false)` from a blur, so a refocus can cancel it.
   *
   * Held in a ref rather than left as a fire-and-forget timeout because the close has
   * to be cancellable: see the note on `onFocus`.
   */
  const blurTimerRef = useRef<number | null>(null);

  // The field itself, measured to decide which way the list opens.
  const fieldRef = useRef<HTMLDivElement>(null);
  const [dropUp, setDropUp] = useState(false);

  // Clear it on unmount so a close cannot fire against a gone component.
  useEffect(
    () => () => {
      if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
    },
    [],
  );

  // OPEN UPWARDS WHEN THERE IS NO ROOM BELOW.
  //
  // A location field is often the LAST one in a form, which puts it at the bottom of
  // whatever contains it — and this list is positioned absolutely rather than
  // portalled, so it is clipped by that container. On the listing form the details
  // rail is a scroll box inside a card whose height is pinned to the viewport: the
  // list opened downwards into nothing, the third suggestion was sliced in half, and
  // the rest could not be reached at all.
  //
  // MEASURED AGAINST THE NEAREST CLIPPING ANCESTOR, not the viewport. Those are the
  // same thing on a plain page and very much not inside a scroll box: the rail's
  // bottom edge sits a footer's height above the card's, so a viewport measurement
  // reports room that the list cannot actually use.
  //
  // Whichever side has more room wins, so a field near the top still opens downwards.
  // Re-measured on scroll — capturing, so a scrolling ancestor is caught, not just the
  // window — and on resize, since either can move the field while the list is open.
  useEffect(() => {
    if (!open) return;
    const el = fieldRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      const bounds = clippingBounds(el);
      const below = bounds.bottom - rect.bottom;
      const above = rect.top - bounds.top;
      setDropUp(below < LIST_MAX_HEIGHT && above > below);
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, results.length, outcome]);

  // Adopt a selection made elsewhere (initial value, parent reset), but never while
  // the user is mid-edit. Keyed on `placeId` so a re-render with an equal-but-new
  // object does not retrigger.
  useEffect(() => {
    if (editingRef.current) return;
    setQuery(value?.label ?? '');
  }, [value?.label, value?.placeId]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      setOutcome('none');
      return;
    }
    // Only skip the search when the text still matches the selection AND the user
    // has not started editing. Previously this early-return fired unconditionally,
    // so a selected field could never produce results again.
    if (!editingRef.current && value && trimmed === value.label.trim()) {
      setResults([]);
      setLoading(false);
      setOutcome('none');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const id = ++requestIdRef.current;

    const handle = window.setTimeout(() => {
      void searchPlaces(trimmed, precision, {
        signal: controller.signal,
        countries: countryKey ? countryKey.split(',') : undefined,
        biasCountry,
      })
        .then((places) => {
          if (requestIdRef.current !== id) return;
          setResults(places);
          setOutcome(places.length > 0 ? 'none' : 'empty');
        })
        .catch(() => {
          // A superseded request is filtered above, so reaching here with the
          // current id means the lookup itself failed — offline, blocked, or the
          // provider erroring. That is not the same as "no such place".
          if (requestIdRef.current !== id) return;
          setResults([]);
          setOutcome('error');
        })
        .finally(() => {
          // No abort guard: a superseded request is filtered by the id check, and
          // the newest request must always be allowed to stop the spinner.
          if (requestIdRef.current === id) setLoading(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(handle);
      controller.abort();
    };
    // `value?.placeId` and `countryKey`, not `value` and `countries` — object and
    // array identities here restarted the debounce on every unrelated parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, precision, value?.placeId, countryKey, biasCountry]);

  function clear() {
    editingRef.current = false;
    requestIdRef.current += 1;
    abortRef.current?.abort();
    setQuery('');
    setResults([]);
    setLoading(false);
    setOutcome('none');
    setOpen(false);
    onClear?.();
  }

  const showClear = !disabled && (query.length > 0 || value != null);

  // Shared by the suggestion list and the "why is this empty" panel so the two can
  // never disagree about which side of the field they sit on.
  const panelPosition = dropUp ? 'bottom-full mb-1' : 'top-full mt-1';

  return (
    <div ref={fieldRef} className={cn('relative', className)}>
      <div className="relative">
        <MapPin
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id={id}
          value={query}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          className="pl-9 pr-16"
          onChange={(event) => {
            const next = event.target.value;
            editingRef.current = true;
            setQuery(next);
            setOpen(true);
            // Acknowledge the keystroke immediately. Waiting for the debounce to
            // start made the field feel dead for the first 250ms.
            setLoading(next.trim().length >= 2);
            // Drop the previous verdict immediately: keeping it would show "No
            // matches" against a query that has not been searched yet.
            setOutcome('none');
            onTextFallback?.(next);
          }}
          onFocus={() => {
            // CANCEL ANY PENDING CLOSE. Without this a blur that happened moments ago
            // still fires its `setOpen(false)` 150ms later — after the field has been
            // refocused and while the member is typing — so the list closes under them
            // for no visible reason.
            //
            // Reachable by clicking away and straight back, or by tabbing out and in
            // inside the delay window. The close is deferred so an option click can
            // register; deferring it should not mean it becomes uncancellable.
            if (blurTimerRef.current !== null) {
              window.clearTimeout(blurTimerRef.current);
              blurTimerRef.current = null;
            }
            setOpen(true);
          }}
          onBlur={() => {
            // Delay so an option click registers before the list unmounts.
            if (blurTimerRef.current !== null) {
              window.clearTimeout(blurTimerRef.current);
            }
            blurTimerRef.current = window.setTimeout(() => {
              blurTimerRef.current = null;
              setOpen(false);
            }, 150);
          }}
        />

        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          {/* The spinner's ROTATION is on the icon and its POSITION is on this
              wrapper. Putting `animate-spin` and `-translate-y-1/2` on the same
              element made the keyframe's `transform` clobber the translate, so the
              icon visibly dropped below centre while loading. */}
          {loading ? (
            <span className="grid size-6 place-items-center" aria-hidden>
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </span>
          ) : null}
          {showClear ? (
            <button
              type="button"
              onClick={clear}
              // A location could previously only be reset by guessing that emptying
              // the field was the way out. Fitts's Law: give it a real target.
              aria-label="Clear location"
              className="grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground border border-transparent focus:outline-none focus-visible:border-gold/40"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      {/* SAY WHY THERE ARE NO OPTIONS. Rendered in the dropdown's own position so it
          is where the member is already looking, and as `role="status"` rather than an
          option so it is never selectable. The two messages are deliberately
          different: one is about the query, the other is about the lookup. */}
      {open && !loading && results.length === 0 && outcome !== 'none' ? (
        <div
          role="status"
          className={cn(
            'absolute z-30 w-full rounded-md border bg-popover px-2 py-2 text-body text-muted-foreground shadow-md',
            panelPosition,
          )}
        >
          {outcome === 'error'
            ? "Couldn't reach address search. Check your connection and try again."
            : countries && countries.length > 0
              ? 'No matching places found here.'
              : 'No matching places found.'}
        </div>
      ) : null}

      {open && results.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className={cn(
            'absolute z-30 max-h-56 w-full overflow-auto rounded-md border bg-popover p-1 text-body shadow-md',
            panelPosition,
          )}
        >
          {results.map((place) => (
            <li key={place.placeId} role="option" aria-selected={value?.placeId === place.placeId}>
              <button
                type="button"
                className="flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left hover:bg-accent"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  editingRef.current = false;
                  onSelect(place);
                  setQuery(place.label);
                  setOpen(false);
                  setResults([]);
                  setLoading(false);
                  setOutcome('none');
                }}
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span>{place.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
