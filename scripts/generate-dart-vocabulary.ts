// scripts/generate-dart-vocabulary.ts
//
// Generates Dart source files from the TypeScript domain modules so the
// agreement between them is structural, not maintained by hand.
//
// Emits:
//   flutter_app/lib/domain/generated/trade_enums.g.dart   (TradeState, TradeEvent, TradeAction)
//   flutter_app/lib/domain/generated/regions.g.dart       (allRegions list)
//   flutter_app/lib/domain/generated/zero_decimal.g.dart  (zeroDecimalCurrencies set)
//
// Each output carries a DO NOT EDIT header naming this generator. The agreement
// test in mobileDomainAgreement.test.ts asserts no diff on regenerate rather than
// parsing both sides independently.
//
// Run:  npx tsx scripts/generate-dart-vocabulary.ts
//       npm run generate:dart-vocab

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const OUT_DIR = path.join(REPO_ROOT, 'flutter_app', 'lib', 'domain', 'generated');

// ─── Helpers ────────────────────────────────────────────────────────────────────

function header(description: string): string {
  return [
    '// GENERATED — DO NOT EDIT',
    `// Source: scripts/generate-dart-vocabulary.ts`,
    `// ${description}`,
    '//',
    '// Re-generate with:  npx tsx scripts/generate-dart-vocabulary.ts',
    '',
  ].join('\n');
}

/** SCREAMING_SNAKE to lowerCamelCase. */
function toCamel(s: string): string {
  return s
    .toLowerCase()
    .replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

// ─── Trade Enums ────────────────────────────────────────────────────────────────

function readTsUnion(source: string, typeName: string): string[] {
  // Strip comments first to avoid matching inside them.
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const match = clean.match(new RegExp(`export type ${typeName}\\s*=([\\s\\S]*?);`, 'm'));
  if (!match) throw new Error(`type ${typeName} not found`);
  const members = [...match[1].matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]);
  if (members.length === 0) throw new Error(`parsed zero members from ${typeName}`);
  return members;
}

function generateTradeEnums(): string {
  const typesSource = readFileSync(
    path.join(REPO_ROOT, 'domain', 'state-machine', 'types.ts'),
    'utf8',
  );

  const states = readTsUnion(typesSource, 'TradeState');
  const events = readTsUnion(typesSource, 'TradeEvent');

  // TradeAction is in a separate file
  const actionsSource = readFileSync(
    path.join(REPO_ROOT, 'domain', 'state-machine', 'actions.ts'),
    'utf8',
  );
  let actions: string[];
  try {
    actions = readTsUnion(actionsSource, 'TradeAction');
  } catch {
    // May be in types.ts too depending on refactoring
    actions = readTsUnion(typesSource, 'TradeAction');
  }

  function dartEnum(name: string, values: string[]): string {
    const entries = values.map(
      (v) => `  @JsonValue('${v}') ${toCamel(v)},`,
    );
    return `enum ${name} {\n${entries.join('\n')}\n}`;
  }

  return [
    header('Trade enums from domain/state-machine/types.ts'),
    "import 'package:json_annotation/json_annotation.dart';",
    '',
    dartEnum('TradeState', states),
    '',
    dartEnum('TradeEvent', events),
    '',
    dartEnum('TradeAction', actions),
    '',
    '/// Terminal states — no further transition is possible.',
    `const terminalTradeStates = {${states.filter(s => ['COMPLETED', 'FRAUD_RESOLVED', 'CANCELLED'].includes(s)).map(s => `TradeState.${toCamel(s)}`).join(', ')}};`,
    '',
  ].join('\n');
}

// ─── Regions ────────────────────────────────────────────────────────────────────

interface ParsedRegion {
  code: string;
  label: string;
  currency: string;
  tradingEnabled: boolean;
}

function parseRegions(): ParsedRegion[] {
  const source = readFileSync(
    path.join(REPO_ROOT, 'domain', 'region', 'regions.ts'),
    'utf8',
  );
  const pattern =
    /\{\s*code:\s*'([A-Z]{2})',\s*label:\s*'([^']*)',\s*currency:\s*'([a-z]{3})',\s*stripeCountry:\s*'[a-z]{2}',\s*locale:\s*'[^']*',\s*tradingEnabled:\s*(true|false)\s*\}/g;

  const regions: ParsedRegion[] = [];
  for (const match of source.matchAll(pattern)) {
    regions.push({
      code: match[1],
      label: match[2],
      currency: match[3],
      tradingEnabled: match[4] === 'true',
    });
  }
  if (regions.length === 0) {
    throw new Error('parseRegions() found zero entries — has the format changed?');
  }
  return regions;
}

function generateRegions(): string {
  const regions = parseRegions();

  const lines = regions.map((r) => {
    const trading = r.tradingEnabled ? ', tradingEnabled: true' : '';
    // Determine minorUnitDigits from ZERO_DECIMAL_CURRENCIES
    const digits = ZERO_DECIMAL.has(r.currency) ? 0 : 2;
    return `  Region(code: '${r.code}', label: '${r.label}', currency: '${r.currency}', minorUnitDigits: ${digits}${trading}),`;
  });

  return [
    header('Region registry from domain/region/regions.ts'),
    "import '../../models/region.dart';",
    '',
    '/// All regions the marketplace can potentially operate in.',
    '/// Presence means Stripe supports the funds flow; tradingEnabled means live.',
    'const List<Region> generatedRegions = [',
    ...lines,
    '];',
    '',
  ].join('\n');
}

// ─── Zero Decimal ───────────────────────────────────────────────────────────────

function parseZeroDecimal(): string[] {
  const source = readFileSync(
    path.join(REPO_ROOT, 'domain', 'region', 'regions.ts'),
    'utf8',
  );
  const match = source.match(/ZERO_DECIMAL_CURRENCIES[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/);
  if (!match) throw new Error('ZERO_DECIMAL_CURRENCIES not found in regions.ts');
  const currencies = [...match[1].matchAll(/'([a-z]{3})'/g)].map((m) => m[1]);
  if (currencies.length === 0) throw new Error('parsed zero currencies');
  return currencies.sort();
}

// Parse once for use in regions too
const ZERO_DECIMAL = new Set(parseZeroDecimal());

function generateZeroDecimal(): string {
  const currencies = [...ZERO_DECIMAL].sort();

  return [
    header('Zero-decimal currencies from domain/region/regions.ts'),
    '',
    '/// Currencies with no minor unit (the smallest unit IS the whole unit).',
    '/// For these, `minorUnitDigits` is 0 and display shows no decimals.',
    'const Set<String> generatedZeroDecimalCurrencies = {',
    ...currencies.map((c) => `  '${c}',`),
    '};',
    '',
  ].join('\n');
}

// ─── Main ───────────────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });

const tradeEnumsContent = generateTradeEnums();
const regionsContent = generateRegions();
const zeroDecimalContent = generateZeroDecimal();

writeFileSync(path.join(OUT_DIR, 'trade_enums.g.dart'), tradeEnumsContent);
writeFileSync(path.join(OUT_DIR, 'regions.g.dart'), regionsContent);
writeFileSync(path.join(OUT_DIR, 'zero_decimal.g.dart'), zeroDecimalContent);

console.log('Generated:');
console.log(`  flutter_app/lib/domain/generated/trade_enums.g.dart  (${tradeEnumsContent.split('\n').length} lines)`);
console.log(`  flutter_app/lib/domain/generated/regions.g.dart      (${regionsContent.split('\n').length} lines)`);
console.log(`  flutter_app/lib/domain/generated/zero_decimal.g.dart (${zeroDecimalContent.split('\n').length} lines)`);
