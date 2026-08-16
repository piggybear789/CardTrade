'use client';

// components/sales/ContractLineItems.tsx
//
// What a Cash_Sale contract covers, as a written statement and a read-only list
// (0064).
//
// WHY THIS EXISTS. A SHOPFRONT listing is a browsable inventory — a binder, a
// bulk lot — so the listing cannot say what any one contract is for. This is that
// statement. It is the basis of the price, it is what both parties re-accept when
// either side changes it, and it is what an arbitrator reads if the sale is
// disputed. Everything a member sees here is the contract, never the listing.
//
// ONE SHAPE, TWO SURFACES. The buyer writes what they want and names a price;
// either party can revise the same two fields in the contract room. Both surfaces
// use `ContractRequestFields` so they cannot drift — a member composing a request
// and then reviewing it must not read the terms as having changed on them.
//
// THE ITEMISED GRID IS GONE, DELIBERATELY. This used to be a repeating row of
// description / condition / quantity / unit price with an "Add another" button.
// It asked a buyer to draft an invoice when what they were doing was describing a
// want — "the three Charizards on page 2, both Blastoise, any NM Pikachu" is one
// sentence, not four rows with per-row grades. The DATA MODEL still supports many
// lines with condition and quantity, because `cash_sale_items` and its CHECK
// constraints are unchanged and `ContractLineItemsList` renders whatever it is
// given; only the composition surface collapsed to one line. If a reason to
// itemise ever comes back, it is a UI addition and not a migration.

import * as React from 'react';

import {
  LINE_DESCRIPTION_MAX_LENGTH,
  type CashSaleLineItemInput,
} from '@/domain/validation/cashSaleLineItems';
import { CURRENCY_CODE, formatMoney } from '@/lib/format';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { Textarea } from '@/components/ui/textarea';

/**
 * A written request mid-edit.
 *
 * Price is a dollars STRING, deliberately: parsing to cents on every keystroke
 * destroys "1." and "0.0" as someone types them.
 */
export interface RequestDraft {
  description: string;
  priceDollars: string;
}

/** A blank request. */
export function emptyRequest(): RequestDraft {
  return { description: '', priceDollars: '' };
}

/**
 * Convert a dollars string to integer cents in the contract's currency, or null
 * when unparseable.
 */
function dollarsToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const dollars = Number(trimmed);
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

/** What the buyer is offering to pay, in integer minor units. Unparseable is 0. */
export function requestTotalCents(request: RequestDraft): number {
  return dollarsToCents(request.priceDollars) ?? 0;
}

/**
 * Map a written request to the action payload as a SINGLE contract line.
 *
 * Returns `[]` for a blank description, which is how a caller detects "nothing
 * asked for" without a second validity flag. Quantity is 1 and condition null
 * because the prose carries both — someone writing "two NM Blastoise" has already
 * said it, and a second place to say it is a second thing that can disagree.
 */
export function toRequestLineItems(request: RequestDraft): CashSaleLineItemInput[] {
  const description = request.description.trim();
  if (description === '') return [];
  return [
    {
      description,
      condition: null,
      quantity: 1,
      unitPriceCents: dollarsToCents(request.priceDollars) ?? 0,
    },
  ];
}

/**
 * Seed the written form from a contract's persisted lines.
 *
 * A contract with several lines collapses to one, joining the descriptions and
 * carrying the SAME total, so nothing about what is owed or charged changes. A
 * quantity above 1 folds into the total for the same reason: `3 × $40` and one
 * line at `$120` are the same contract, and the prose still says "3". No contract
 * in the database uses more than one line, a quantity above 1, or a per-line
 * condition — this path exists so an old one could not be silently mispriced, not
 * because it is expected.
 */
export function toRequestDraft(
  lines: readonly {
    description: string;
    condition: string | null;
    quantity: number;
    unitPriceCents: number;
  }[],
): RequestDraft {
  if (lines.length === 0) return emptyRequest();
  const totalCents = lines.reduce(
    (sum, line) => sum + line.quantity * line.unitPriceCents,
    0,
  );
  const description = lines
    .map((line) => {
      const quantity = line.quantity > 1 ? `${line.quantity} × ` : '';
      const condition = line.condition ? ` (${line.condition})` : '';
      return `${quantity}${line.description}${condition}`;
    })
    .join('\n');
  return { description, priceDollars: (totalCents / 100).toFixed(2) };
}

/**
 * What the contract covers and what it costs: a description and a price.
 *
 * Two fields, because until both parties accept there is nothing settled — either
 * side can still change both, and the contract room is where that happens. The
 * price is framed as an offer rather than a total, since the platform fee and any
 * postage land on top of it once terms are agreed.
 */
export function ContractRequestFields({
  value,
  onChange,
  disabled = false,
  error = null,
  currency = CURRENCY_CODE,
  idPrefix = 'request',
  descriptionLabel = 'What you want',
  descriptionHint = 'You can both change this in the contract before either of you accepts.',
  priceLabel = 'Your offer',
}: {
  value: RequestDraft;
  onChange: (next: RequestDraft) => void;
  disabled?: boolean;
  /** Inline validation message, announced to assistive tech. */
  error?: string | null;
  /** The currency this request is priced in (0068). */
  currency?: string;
  /** Distinguishes the field ids when two of these could ever coexist. */
  idPrefix?: string;
  descriptionLabel?: string;
  descriptionHint?: string;
  priceLabel?: string;
}) {
  const offerCents = requestTotalCents(value);
  const descriptionId = `${idPrefix}-description`;
  const priceId = `${idPrefix}-price`;

  return (
    <div className="space-y-cozy">
      <div className="space-y-tight">
        <Label htmlFor={descriptionId}>{descriptionLabel}</Label>
        <Textarea
          id={descriptionId}
          value={value.description}
          onChange={(event) => onChange({ ...value, description: event.target.value })}
          maxLength={LINE_DESCRIPTION_MAX_LENGTH}
          rows={4}
          placeholder="The three Charizards on page 2, both Blastoise, and any NM Pikachu you have."
          disabled={disabled}
          aria-describedby={`${descriptionId}-hint`}
        />
        <p id={`${descriptionId}-hint`} className="text-meta text-muted-foreground">
          {descriptionHint}
        </p>
      </div>

      <div className="space-y-tight">
        <Label htmlFor={priceId}>{priceLabel}</Label>
        <MoneyInput
          id={priceId}
          value={value.priceDollars}
          onChange={(event) => onChange({ ...value, priceDollars: event.target.value })}
          placeholder="120.00"
          min="0.01"
          disabled={disabled}
          aria-describedby={`${priceId}-hint`}
        />
      </div>

      {error ? (
        <p role="alert" className="text-body text-destructive">
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
 * never from the listing, which the seller can still edit afterwards. Still
 * handles many lines, per-line condition and quantity, because the data model
 * does; a contract written through the form above is simply one line.
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
  const itemised = lines.length > 1 || lines.some((line) => line.quantity > 1);

  return (
    <div className="space-y-group">
      {/* Headed prose, not a framed list. The tab this renders in is already a
          surface, so the border around the lines read as a card inside a card —
          and it framed a paragraph of prose as though it were a table. Same
          treatment as the single-item snapshot's description, so a binder
          contract and a one-object contract describe their goods identically. */}
      <div>
        <h4 className="text-body font-semibold">Description</h4>
        <div className="mt-2 space-y-snug">
          {lines.map((line, index) => (
            <div
              key={line.id ?? index}
              className="flex items-baseline justify-between gap-cozy text-body"
            >
              <div className="min-w-0">
                {/* `whitespace-pre-wrap`: the description is prose, and a written
                    want list uses line breaks. Collapsing them ran three cards
                    into one sentence. */}
                <p className="whitespace-pre-wrap break-words text-muted-foreground">
                  {line.description}
                </p>
                {line.quantity > 1 || line.condition ? (
                  <p className="text-meta text-muted-foreground">
                    {line.quantity > 1 ? `${line.quantity} × ${money(line.unitPriceCents)}` : ''}
                    {line.quantity > 1 && line.condition ? ' · ' : ''}
                    {line.condition ?? ''}
                  </p>
                ) : null}
              </div>
              {/* A single line's amount IS the total below it, so printing it twice
                  was noise. Shown only when the list is itemised. */}
              {itemised ? (
                <span className="shrink-0 font-medium">
                  {money(line.quantity * line.unitPriceCents)}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between border-t pt-cozy text-body">
        <span className="text-muted-foreground">Agreed price</span>
        <span className="font-semibold">{money(total)}</span>
      </div>
    </div>
  );
}
