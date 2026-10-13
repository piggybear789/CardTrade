// tests/unit/tradeClockAgreement.test.ts
//
// The trade clocks exist twice: as TypeScript constants that copy, sizing and the
// planning figures read, and as pinned SQL functions the triggers read. They drifted
// once already — `TRADE_INSPECTION_HOURS` said 120 while `trade_inspection_hours()`
// said 72, so members were promised five days and given three (ESC-17a).
//
// This reads the NEWEST migration defining each function, in the `select N` form, and
// compares it with the constant, in the style of regionCurrencyAgreement. It throws
// when a function is missing or not in the pinned form, so it cannot pass vacuously.

import { describe, expect, it } from 'vitest';

import {
  BOND_PLACEMENT_LEAD_HOURS,
  COLLATERAL_MARGIN_HOURS,
  TRADE_INSPECTION_FLOOR_HOURS,
  TRADE_INSPECTION_HOURS,
} from '@/domain/fulfilment';
import { CASH_SALE_INSPECTION_DAYS, IN_PERSON_INSPECTION_HOURS, RETURN_INSPECTION_HOURS } from '@/domain/fulfilment/inspection';
import { sqlFunctions } from '@/scripts/lib/mobileContract';
import { pinnedIntegerFunction } from '@/scripts/lib/migrationText';

const PINNED: Array<[sqlName: string, tsName: string, tsValue: number]> = [
  ['trade_inspection_hours', 'TRADE_INSPECTION_HOURS', TRADE_INSPECTION_HOURS],
  ['trade_inspection_floor_hours', 'TRADE_INSPECTION_FLOOR_HOURS', TRADE_INSPECTION_FLOOR_HOURS],
  ['collateral_margin_hours', 'COLLATERAL_MARGIN_HOURS', COLLATERAL_MARGIN_HOURS],
  ['bond_placement_lead_hours', 'BOND_PLACEMENT_LEAD_HOURS', BOND_PLACEMENT_LEAD_HOURS],
  // ESC-02: staff START_CLOCK computes the cash-sale deadline in TypeScript.
  ['cash_sale_inspection_days', 'CASH_SALE_INSPECTION_DAYS', CASH_SALE_INSPECTION_DAYS],
  // ESC-20: the in-person buyer inspection.
  ['in_person_inspection_hours', 'IN_PERSON_INSPECTION_HOURS', IN_PERSON_INSPECTION_HOURS],
  // ESC-11: the seller's return inspection.
  ['return_inspection_hours', 'RETURN_INSPECTION_HOURS', RETURN_INSPECTION_HOURS],
];

describe('SQL trade clocks agree with the TypeScript constants', () => {
  it.each(PINNED)('cardtrade.%s() equals %s', (sqlName, tsName, tsValue) => {
    const pinned = pinnedIntegerFunction(sqlName);
    expect(pinned.value, `${sqlName} in ${pinned.file} vs ${tsName}`).toBe(tsValue);
  });

  it('reads the same newest definition the function index does', () => {
    // Guards the reader itself: if it picked an older file than the shared index,
    // a redefinition could slip past this test.
    const index = sqlFunctions();
    for (const [sqlName] of PINNED) {
      expect(pinnedIntegerFunction(sqlName).file).toBe(index.get(sqlName)?.definedIn);
    }
  });
});
