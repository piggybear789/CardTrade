'use client';

// components/sales/ContractLineItems.tsx
//
// The goods a Cash_Sale contract covers, as an editable list and a read-only one
// (0064).
//
// WHY THIS EXISTS. A SHOPFRONT listing is a browsable inventory — a binder, a
// bulk lot — so the listing cannot say what any one contract is for. These lines
// are that statement. They are the basis of the price, they are what both parties
// re-accept when either side changes them, and they are what an arbitrator reads
// if the sale is disputed. Everything a member sees here is the contract, never
// the listing.
//
// Both surfaces live in one module because they must agree on how a line reads:
// the buyer composes a request in the editor and then reviews the same lines in
// the contract room, and any drift between the two would look like the terms had
// changed on them.

import * as React from 'react';
import { Plus, X } from 'lucide-react';

import {
  LINE_DESCRIPTION_MAX_LENGTH,
  LINE_QUANTITY_MAX,
  LINES_MAX,
  type CashSaleLineItemInput,
} from '@/domain/validation/cashSaleLineItems';
import { CURRENCY_CODE, formatMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';

/** A row mid-edit. Price is a dollars STRING so a half-typed value survives. */
export interface DraftLine {
  description: string;
  condition: string;
  quantity: string;
  priceDollars: string;
}

/** One blank row. */
export function emptyLine(): DraftLine {
  return { description: '', condition: '', quantity: '1', priceDollars: '' };
}

/**
 * Convert a dollars string to integer AUD cents, or null when unparseable.
 *
 * Mirrors `ItemForm`'s conversion so the same typed value means the same money on
 * both forms.
 */
function dollarsToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const dollars = Number(trimmed);
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

function quantityOf(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Running total of the draft rows, in integer cents. Unparseable rows count 0. */
export function draftTotalCents(lines: readonly DraftLine[]): number {
  return lines.reduce(
    (sum, line) => sum + quantityOf(line.quantity) * (dollarsToCents(line.priceDollars) ?? 0),
    0,
  );
}

/**
 * Map draft rows to the action payload, dropping rows with no description.
 *
 * Blank rows are dropped rather than rejected: an empty trailing row is how
 * people leave a list they have finished with, not an error worth blocking on.
 */
export function toLineItemInput(lines: readonly DraftLine[]): CashSaleLineItemInput[] {
  return lines
    .filter((line) => line.description.trim() !== '')
    .map((line) => ({
      description: line.description.trim(),
      condition: line.condition.trim() || null,
      quantity: quantityOf(line.quantity) || 1,
      unitPriceCents: dollarsToCents(line.priceDollars) ?? 0,
    }));
}

/** Turn persisted lines back into editable rows. */
export function toDraftLines(
  lines: readonly {
    description: string;
    condition: string | null;
    quantity: number;
    unitPriceCents: number;
  }[],
): DraftLine[] {
  if (lines.length === 0) return [emptyLine()];
  return lines.map((line) => ({
    description: line.description,
    condition: line.condition ?? '',
    quantity: String(line.quantity),
    priceDollars: (line.unitPriceCents / 100).toFixed(2),
  }));
}

export interface ContractLineItemsEditorProps {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  disabled?: boolean;
  /** Inline validation message from the server, announced to assistive tech. */
  error?: string | null;
  /**
   * The currency these lines are priced in (0068).
   *
   * Optional so the editor keeps working where the currency is not yet threaded; it
   * then falls back to the default region's presentation. The read-only list beside
   * it takes the same option, because the editor and the list must never disagree —
   * a member composing a request and then reviewing it in the contract room would
   * otherwise read the terms as having changed.
   */
  currency?: string;
}

/**
 * Editable list of contract lines with a running total.
 *
 * The total is shown continuously and prominently because it is the number that
 * will actually be charged — it is derived from these rows and nowhere else, so a
 * member must never have to work it out themselves.
 */
export function ContractLineItemsEditor({
  lines,
  onChange,
  disabled = false,
  error = null,
  currency = CURRENCY_CODE,
}: ContractLineItemsEditorProps) {
  const total = draftTotalCents(lines);
  const money = (cents: number) => formatMoney(cents, currency);

  function update(index: number, patch: Partial<DraftLine>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function remove(index: number) {
    const next = lines.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : [emptyLine()]);
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {lines.map((line, index) => (
          <li key={index} className="space-y-2 rounded-md border p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor={`line-description-${index}`} className="text-xs">
                  Item
                </Label>
                <Input
                  id={`line-description-${index}`}
                  value={line.description}
                  onChange={(event) => update(index, { description: event.target.value })}
                  maxLength={LINE_DESCRIPTION_MAX_LENGTH}
                  placeholder="Charizard ex 199/165 — SV 151"
                  disabled={disabled}
                />
              </div>
              {lines.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mt-5 shrink-0"
                  onClick={() => remove(index)}
                  disabled={disabled}
                  aria-label={`Remove item ${index + 1}`}
                >
                  <X className="size-4" aria-hidden />
                </Button>
              ) : null}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label htmlFor={`line-condition-${index}`} className="text-xs">
                  Condition
                </Label>
                <Input
                  id={`line-condition-${index}`}
                  value={line.condition}
                  onChange={(event) => update(index, { condition: event.target.value })}
                  maxLength={60}
                  placeholder="Near Mint"
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`line-quantity-${index}`} className="text-xs">
                  Qty
                </Label>
                <Input
                  id={`line-quantity-${index}`}
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max={LINE_QUANTITY_MAX}
                  value={line.quantity}
                  onChange={(event) => update(index, { quantity: event.target.value })}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`line-price-${index}`} className="text-xs">
                  Each
                </Label>
                <MoneyInput
                  id={`line-price-${index}`}
                  value={line.priceDollars}
                  onChange={(event) => update(index, { priceDollars: event.target.value })}
                  placeholder="40.00"
                  disabled={disabled}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>

      {lines.length < LINES_MAX ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...lines, emptyLine()])}
          disabled={disabled}
        >
          <Plus className="size-4" aria-hidden />
          Add another
        </Button>
      ) : null}

      <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
        <span className="font-medium">Items total</span>
        <span className="font-semibold">{money(total)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        The 5% platform fee and any postage are added on top when you agree terms.
      </p>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** One persisted line, as the contract room and arbitration surfaces read it. */
export interface ContractLine {
  id?: string;
  description: string;
  condition: string | null;
  quantity: number;
  unitPriceCents: number;
}

/**
 * Read-only list of what a contract covers.
 *
 * Rendered from the CONTRACT's own rows, which are frozen once payment starts —
 * never from the listing, which the seller can still edit afterwards.
 */
export function ContractLineItemsList({
  lines,
  currency = CURRENCY_CODE,
}: {
  lines: readonly ContractLine[];
  /** The contract's currency (0068). Must match the editor's, deliberately. */
  currency?: string;
}) {
  const money = (cents: number) => formatMoney(cents, currency);
  if (lines.length === 0) return null;

  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0);

  return (
    <div className="space-y-2">
      <ul className="divide-y rounded-md border">
        {lines.map((line, index) => (
          <li
            key={line.id ?? index}
            className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <p className="break-words font-medium">{line.description}</p>
              <p className="text-xs text-muted-foreground">
                {line.quantity > 1 ? `${line.quantity} × ` : ''}
                {money(line.unitPriceCents)}
                {line.condition ? ` · ${line.condition}` : ''}
              </p>
            </div>
            <span className="shrink-0 font-medium">
              {money(line.quantity * line.unitPriceCents)}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between px-3 text-sm">
        <span className="text-muted-foreground">Items total</span>
        <span className="font-semibold">{money(total)}</span>
      </div>
    </div>
  );
}
