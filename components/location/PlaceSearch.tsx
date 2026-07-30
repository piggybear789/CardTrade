'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, MapPin } from 'lucide-react';

import { searchPlaces } from '@/lib/location/geoapify';
import type { PlacePrecision, PlaceValue } from '@/lib/location/types';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface PlaceSearchProps {
  precision: PlacePrecision;
  value: PlaceValue | null;
  onSelect: (place: PlaceValue) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  className?: string;
  /** Allow free-text when Geoapify is unavailable (graceful degrade). */
  onTextFallback?: (label: string) => void;
}

export function PlaceSearch({
  precision,
  value,
  onSelect,
  placeholder = 'Search for a place in Australia',
  disabled,
  id,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  className,
  onTextFallback,
}: PlaceSearchProps) {
  const listId = useId();
  const [query, setQuery] = useState(value?.label ?? '');
  const [results, setResults] = useState<PlaceValue[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setQuery(value?.label ?? '');
  }, [value?.label, value?.placeId]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    // Don't re-search when the query already matches the selected place.
    if (value && trimmed === value.label.trim()) {
      setResults([]);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const handle = window.setTimeout(() => {
      setLoading(true);
      void searchPlaces(trimmed, precision, { signal: controller.signal })
        .then((places) => {
          if (!controller.signal.aborted) setResults(places);
        })
        .catch(() => {
          if (!controller.signal.aborted) setResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(handle);
      controller.abort();
    };
  }, [query, precision, value]);

  return (
    <div className={cn('relative', className)}>
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
          className="pl-9 pr-9"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            onTextFallback?.(event.target.value);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay so option click registers.
            window.setTimeout(() => setOpen(false), 150);
          }}
        />
        {loading ? (
          <Loader2
            className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden
          />
        ) : null}
      </div>

      {open && results.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md"
        >
          {results.map((place) => (
            <li key={place.placeId} role="option" aria-selected={value?.placeId === place.placeId}>
              <button
                type="button"
                className="flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left hover:bg-accent"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSelect(place);
                  setQuery(place.label);
                  setOpen(false);
                  setResults([]);
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
