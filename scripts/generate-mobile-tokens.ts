// scripts/generate-mobile-tokens.ts
//
// Generates the Flutter colour-token layer from app/globals.css so web and mobile
// share one palette source. Requirements 1.1–1.4, 15.3–15.5.
//
// Run: npx tsx scripts/generate-mobile-tokens.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { hslToArgb, webColorTokens } from './lib/mobileContract';

const REPO_ROOT = process.cwd();
const OUTPUT = path.join(REPO_ROOT, 'flutter_app', 'lib', 'core', 'theme', 'tokens.g.dart');

function dartHex(argb: number): string {
  return `0x${argb.toString(16).toUpperCase().padStart(8, '0')}`;
}

function generateTokens(): string {
  const tokens = webColorTokens();
  const declarations = tokens.map(({ camel, hsl, token }) =>
    `  /// Generated from ${token}: ${hsl[0]} ${hsl[1]}% ${hsl[2]}%.\n` +
    `  static const Color ${camel} = Color(${dartHex(hslToArgb(hsl))});`,
  );

  return [
    '// GENERATED — DO NOT EDIT',
    '// Source: scripts/generate-mobile-tokens.ts',
    '// Source tokens: app/globals.css :root',
    '// Re-generate with: npx tsx scripts/generate-mobile-tokens.ts',
    '',
    "import 'package:flutter/material.dart';",
    '',
    '/// Web-aligned palette for the Flutter presentation layer.',
    '///',
    '/// Every value is generated from a resolved `:root` colour token.',
    'abstract final class AppColors {',
    ...declarations,
    '}',
    '',
  ].join('\n');
}

mkdirSync(path.dirname(OUTPUT), { recursive: true });
const content = generateTokens();
writeFileSync(OUTPUT, content);
console.log(`Generated ${path.relative(REPO_ROOT, OUTPUT).replace(/\\/g, '/')} (${webColorTokens().length} colours)`);
