'use client';

// Pick which of your AVAILABLE listings go on a trade offer. Kept in a dialog
// so large inventories can be searched without bloating the compose surface —
// the form only shows what you confirmed.

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatAud } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ItemRow } from '@/lib/actions/listings';

export interface OwnItemsPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ItemRow[];
  /** Committed selection from the form; seeds the draft when opened. */
  selectedIds: string[];
  /** Ordered ids — first remains the primary listed item on the offer. */
  onConfirm: (ids: string[]) => void;
}

export function OwnItemsPickerDialog({
  open,
  onOpenChange,
  items,
  selectedIds,
  onConfirm,
}: OwnItemsPickerDialogProps) {
  const [draftIds, setDraftIds] = useState<string[]>(selectedIds);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open) {
      setDraftIds(selectedIds);
      setQuery('');
    }
  }, [open, selectedIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return items;
    return items.filter((item) => item.title.toLowerCase().includes(q));
  }, [items, query]);

  function toggleItem(itemId: string) {
    setDraftIds((current) =>
      current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [...current, itemId],
    );
  }

  function handleDone() {
    onConfirm(draftIds);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92dvh,100dvh-env(safe-area-inset-top))] flex-col gap-0 overflow-hidden p-0 sm:max-h-[min(92dvh,100dvh-3rem)] sm:max-w-lg">
        <DialogHeader className="shrink-0 space-y-1 border-b border-border/70 px-4 pb-3 pt-2 pr-14 sm:px-6 sm:py-4">
          <DialogTitle>Your listings</DialogTitle>
          <DialogDescription>
            Tick what you are putting up. The first selected is the primary item.
          </DialogDescription>
        </DialogHeader>

        <div className="shrink-0 space-y-2 px-4 py-3 sm:px-6">
          <Label htmlFor="own-items-search" className="sr-only">
            Search your listings
          </Label>
          <Input
            id="own-items-search"
            type="search"
            autoComplete="off"
            placeholder="Search your listings"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {draftIds.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {draftIds.length} selected
            </p>
          ) : null}
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3 [scrollbar-gutter:stable] sm:px-6">
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No listings match.
            </p>
          ) : (
            <ul className="min-w-0 space-y-1">
              {filtered.map((item) => {
                const checked = draftIds.includes(item.id);
                return (
                  <li key={item.id}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-md border p-2.5 text-sm transition-colors',
                        'has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-ring',
                        checked && 'border-primary bg-primary/5',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleItem(item.id)}
                        className="size-4 shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatAud(item.fmv_cents)}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="static z-auto mt-0 shrink-0 border-t border-border/70 bg-card px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-none supports-[backdrop-filter]:bg-card sm:border-t sm:bg-card sm:px-6 sm:pb-4 sm:pt-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleDone}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
