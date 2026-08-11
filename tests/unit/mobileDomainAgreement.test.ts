// tests/unit/mobileDomainAgreement.test.ts
//
// Pins the Dart ports in `flutter_app/lib/domain/` and `flutter_app/lib/models/`
// to the TypeScript they were copied from.
//
// WHY THIS EXISTS. Eight Dart files re-derive rules the steering docs describe as
// living in exactly ONE place: the transition table, the bond policy, the
// Identity_Gate, the region registry, the trade fee, the binder rule, the fulfilment
// validator. `core/money.dart` re-derives `minorUnitDigits` on top of that. The
// ports were faithful when they were written — that is not the problem. The problem
// is that nothing would notice if they stopped being faithful, and a money rule with
// two definitions and no pin between them is the exact shape of bug this codebase
// has already paid for twice: `replace_cash_sale_items` re-derives the line-item
// total in SQL and aborts on disagreement, and `regionCurrencyAgreement.test.ts`
// parses migration 0068 for the same reason.
//
// This test is that pattern applied across the language boundary. The Dart side
// cannot import the TypeScript, so the TypeScript reads the Dart.
//
// A failure here does NOT mean the Dart is wrong. It means the two copies disagree
// and someone has to decide which is right — and then, preferably, generate the Dart
// so the question cannot arise again.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { minorUnitDigits, REGIONS } from '@/domain/region';
import { TRANSITIONS } from '@/domain/state-machine/machine';
import { TERMINAL_STATES } from '@/domain/state-machine/types';
import {
  dartEnumValues,
  dartRegions,
  dartRetiredVocabularyHits,
  dartTransitions,
  dartZeroDecimalCurrencies,
  tsUnionMembers,
} from '@/scripts/lib/mobileContract';

const STATE_MACHINE_TYPES = 'domain/state-machine/types.ts';
const GENERATED_DIR = path.join(process.cwd(), 'flutter_app', 'lib', 'domain', 'generated');

describe('generated Dart vocabulary is up to date (no-diff-on-regenerate)', () => {
  // The generator reads the TypeScript and emits Dart. If the generated files on
  // disk disagree with what the generator would produce now, someone changed the
  // TypeScript without regenerating. Run `npm run generate:dart-vocab` to fix.

  it('trade_enums.g.dart matches the current TypeScript', () => {
    const onDisk = readFileSync(path.join(GENERATED_DIR, 'trade_enums.g.dart'), 'utf8');
    const states = tsUnionMembers('TradeState', STATE_MACHINE_TYPES);
    const events = tsUnionMembers('TradeEvent', STATE_MACHINE_TYPES);
    const actions = tsUnionMembers('TradeAction', STATE_MACHINE_TYPES);
    // Verify the generated file has each member
    for (const s of states) expect(onDisk, `TradeState.${s} missing from generated`).toContain(`@JsonValue('${s}')`);
    for (const e of events) expect(onDisk, `TradeEvent.${e} missing from generated`).toContain(`@JsonValue('${e}')`);
    for (const a of actions) expect(onDisk, `TradeAction.${a} missing from generated`).toContain(`@JsonValue('${a}')`);
  });

  it('regions.g.dart covers every TypeScript region', () => {
    const onDisk = readFileSync(path.join(GENERATED_DIR, 'regions.g.dart'), 'utf8');
    for (const region of REGIONS) {
      expect(onDisk, `region ${region.code} missing from generated`).toContain(`code: '${region.code}'`);
      expect(onDisk, `label for ${region.code}`).toContain(`label: '${region.label}'`);
    }
  });

  it('zero_decimal.g.dart matches the TypeScript zero-decimal set', () => {
    const onDisk = readFileSync(path.join(GENERATED_DIR, 'zero_decimal.g.dart'), 'utf8');
    const dartSet = dartZeroDecimalCurrencies();
    for (const c of dartSet) {
      expect(onDisk, `${c} should appear in generated zero_decimal`).toContain(`'${c}'`);
    }
  });
});

describe('Dart enums agree with the TypeScript unions', () => {
  it('TradeState matches, byte for byte', () => {
    // 9 values, and the same 9 as the `cardtrade.trade_state` Postgres enum. A
    // tenth on either side is a state one client can represent and the other cannot.
    expect(dartEnumValues('TradeState').sort()).toEqual(
      tsUnionMembers('TradeState', STATE_MACHINE_TYPES).sort(),
    );
  });

  it('TradeEvent matches', () => {
    expect(dartEnumValues('TradeEvent').sort()).toEqual(
      tsUnionMembers('TradeEvent', STATE_MACHINE_TYPES).sort(),
    );
  });

  it('TradeAction matches', () => {
    expect(dartEnumValues('TradeAction').sort()).toEqual(
      tsUnionMembers('TradeAction', STATE_MACHINE_TYPES).sort(),
    );
  });

  it('does not confuse a state for an event', () => {
    // product.md records this specific mistake: the doc once listed states and
    // events as one flat union. BOTH_SHIPPED and HANDOVER_FAILED are events.
    const states = dartEnumValues('TradeState');
    for (const event of ['BOTH_SHIPPED', 'BOTH_RECEIVED', 'BOTH_HANDOVER_CONFIRMED', 'HANDOVER_FAILED']) {
      expect(states, `${event} must not appear as a Trade_State`).not.toContain(event);
    }
  });
});

describe('the Dart transition table is the TypeScript transition table', () => {
  const dart = dartTransitions();

  it('parsed a table at all', () => {
    expect(Object.keys(dart).length).toBe(Object.keys(TRANSITIONS).length);
  });

  it('has the same source states', () => {
    expect(Object.keys(dart).sort()).toEqual(Object.keys(TRANSITIONS).sort());
  });

  it('has the same edges out of every state', () => {
    for (const [from, edges] of Object.entries(TRANSITIONS)) {
      expect(dart[from], `no Dart entry for ${from}`).toBeDefined();
      expect(dart[from], `edges out of ${from} disagree`).toEqual(edges);
    }
  });

  it('agrees on which states are terminal', () => {
    const dartTerminal = Object.entries(dart)
      .filter(([, edges]) => Object.keys(edges).length === 0)
      .map(([state]) => state)
      .sort();
    expect(dartTerminal).toEqual([...TERMINAL_STATES].sort());
  });

  it('keeps both routes from COLLATERAL_LOCKED to INSPECTION', () => {
    // The DELIVERY and IN_PERSON routes converge deliberately, and the in-person one
    // must land on INSPECTION rather than COMPLETED: confirming a handover says "we
    // met and swapped", not "I am satisfied".
    expect(dart.COLLATERAL_LOCKED.BOTH_SHIPPED).toBe('IN_TRANSIT');
    expect(dart.COLLATERAL_LOCKED.BOTH_HANDOVER_CONFIRMED).toBe('INSPECTION');
    expect(dart.COLLATERAL_LOCKED.BOTH_HANDOVER_CONFIRMED).not.toBe('COMPLETED');
  });

  it('keeps HANDOVER_FAILED as a freeze, not a completion', () => {
    expect(dart.COLLATERAL_LOCKED.HANDOVER_FAILED).toBe('DISPUTED');
    expect(dart.IN_TRANSIT.HANDOVER_FAILED).toBe('DISPUTED');
  });
});

describe('the Dart region registry is the TypeScript region registry', () => {
  const dart = dartRegions();

  it('parsed the rows', () => {
    expect(dart.length).toBeGreaterThan(30);
  });

  it('covers exactly the same region codes', () => {
    expect(dart.map((r) => r.code).sort()).toEqual(REGIONS.map((r) => r.code).sort());
  });

  it('agrees on currency, label and trading flag for every region', () => {
    for (const row of dart) {
      const region = REGIONS.find((candidate) => candidate.code === row.code);
      expect(region, `no TypeScript region for ${row.code}`).toBeDefined();
      expect(region!.currency, `currency mismatch for ${row.code}`).toBe(row.currency);
      expect(region!.label, `label mismatch for ${row.code}`).toBe(row.label);
      expect(region!.tradingEnabled, `tradingEnabled mismatch for ${row.code}`).toBe(
        row.tradingEnabled,
      );
    }
  });

  it('agrees on minor-unit digits, where a mismatch is a factor-of-100 money bug', () => {
    for (const row of dart) {
      expect(
        minorUnitDigits(row.currency),
        `minorUnitDigits mismatch for ${row.code} (${row.currency})`,
      ).toBe(row.minorUnitDigits);
    }
  });

  it('agrees that only AU is tradeable today', () => {
    // Badging a member ready in a browse-only region and then refusing every
    // contract they open is the shape of the 0060 mistake.
    expect(dart.filter((r) => r.tradingEnabled).map((r) => r.code)).toEqual(
      REGIONS.filter((r) => r.tradingEnabled).map((r) => r.code),
    );
  });

  it('agrees on the zero-decimal currencies', () => {
    // `core/money.dart` keeps its own set, and it is the divisor for every money
    // figure the app renders. JPY at 2 digits would show ¥123.45 for ¥12,345.
    for (const currency of dartZeroDecimalCurrencies()) {
      expect(minorUnitDigits(currency), `${currency} should be zero-decimal`).toBe(0);
    }
    expect(dartZeroDecimalCurrencies()).toContain('jpy');
  });
});

describe('retired vocabulary stays retired in the Flutter app', () => {
  // The web app cannot reintroduce these: the tables and types are gone, so it would
  // not compile. The Flutter app can, because it names everything as a string — and
  // it did. `features/deals/screens/deals_screen.dart` is wired to AppRoutes.trades.
  it('does not mention Deal, DittoBond, KYC or the Police Evidence Pack', () => {
    const hits = dartRetiredVocabularyHits(['deals', 'dittobond', 'kyc_status', 'police_evidence']);
    expect(
      hits.map((h) => `${h.term} at ${h.file}:${h.line}`),
      'retired vocabulary: Deal went with migration 0055, KYC_Status had no gate ' +
        'behind it, and the Police Evidence Pack was withdrawn deliberately. ' +
        'Member-facing copy says "trade collateral", never DittoBond.',
    ).toEqual([]);
  });
});
