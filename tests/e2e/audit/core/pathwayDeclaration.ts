// tests/e2e/audit/core/pathwayDeclaration.ts
//
// PATHWAY DECLARATIONS: the pure half of the Pathway DSL (`audit/pathway.ts`). Pure: no
// I/O, no Playwright, no environment. It validates what a spec declares, generates the
// tags Playwright selects on, and turns the declaration into the JSON-safe form the
// `audit-pathway` record carries.
//
// Requirements:
//   4.4   a Pathway on the mock provider states why (`mockReason`)
//   6.1   every Pathway has a unique, well-formed id, a title, an area and a kind
//   29.1  a Pathway runs on both viewports unless it records why it is viewport-specific
//   30.9  a suppression names a known check, a valid URL pattern and a written reason
//   35.3  `@id:`, `@area:`, `@kind:`, `@aux` and `@isolated` tags, so `--grep` selects one
//         Pathway, one area or one server

import { isMemberLabel, isPathwayId, isViewport } from './artifactPaths';
import { AREAS } from './coverageMap';
import type { PathwayDeclaration, SimMechanism } from './aggregate';
import { UX_CHECKS, type Suppression, type UxCheck } from './uxPolicy';

/** A suppression as a spec writes it: the URL pattern may be a RegExp. */
export interface SuppressionInput {
  check: UxCheck;
  url: RegExp | string;
  reason: string;
}

/**
 * The fields of a declaration this module checks. `members` is keyed by label; the
 * values are the Playwright half's business (seed user, persona spec or `'guest'`).
 */
export interface DeclarationInput extends Omit<PathwayDeclaration, 'members' | 'suppress'> {
  members: Readonly<Record<string, unknown>>;
  suppress?: readonly SuppressionInput[];
}

/** A finding number as `FINDINGS.md` spells it. */
const FINDING_ID = /^F\d+$/;

const isBlank = (value: unknown): boolean => typeof value !== 'string' || value.trim() === '';

/** A suppression's URL pattern as the regular-expression SOURCE the record stores. */
export function suppressionSource(url: RegExp | string): string {
  return typeof url === 'string' ? url : url.source;
}

/**
 * Every problem with a declaration, in a stable order, or an empty list. Each message
 * names the Pathway (or says it has no valid id) and the field at fault.
 */
export function declarationProblems(declaration: DeclarationInput): string[] {
  const problems: string[] = [];
  const id = typeof declaration.id === 'string' ? declaration.id : '';
  const who = isPathwayId(id) ? `Pathway "${id}"` : `Pathway ${JSON.stringify(declaration.id)}`;

  if (!isPathwayId(id)) {
    problems.push(`${who}: the id must be dotted lowercase segments, e.g. "cash-sale.pay.card-3ds".`);
  }
  if (isBlank(declaration.title)) problems.push(`${who}: the title is blank.`);
  if (!(AREAS as readonly string[]).includes(declaration.area)) {
    problems.push(`${who}: unknown area ${JSON.stringify(declaration.area)}.`);
  }
  if (declaration.kind !== 'happy' && declaration.kind !== 'refusal') {
    problems.push(`${who}: kind must be "happy" or "refusal".`);
  }
  if (declaration.provider !== 'stripe' && declaration.provider !== 'mock') {
    problems.push(`${who}: provider must be "stripe" or "mock".`);
  }
  if (declaration.provider === 'mock' && isBlank(declaration.mockReason)) {
    problems.push(`${who}: a mock-provider Pathway needs a written mockReason.`);
  }
  if (declaration.provider === 'stripe' && declaration.mockReason !== undefined) {
    problems.push(`${who}: mockReason is only for provider "mock".`);
  }

  const labels = Object.keys(declaration.members ?? {});
  if (labels.length === 0) problems.push(`${who}: declares no members.`);
  for (const label of labels) {
    if (!isMemberLabel(label)) {
      problems.push(`${who}: invalid member label ${JSON.stringify(label)} (lowercase word, hyphens allowed).`);
    }
  }

  const viewports = declaration.viewports;
  if (viewports !== 'both') {
    if (typeof viewports !== 'object' || viewports === null || !isViewport(String(viewports.only))) {
      problems.push(`${who}: viewports must be "both" or { only: "desktop" | "phone", reason }.`);
    } else if (isBlank(viewports.reason)) {
      problems.push(`${who}: viewports.only needs a written reason.`);
    }
  }

  for (const [n, suppression] of (declaration.suppress ?? []).entries()) {
    const at = `${who}: suppress[${n}]`;
    if (!(UX_CHECKS as readonly string[]).includes(suppression.check)) {
      problems.push(`${at} names an unknown check ${JSON.stringify(suppression.check)}.`);
    }
    if (isBlank(suppression.reason)) problems.push(`${at} has no written reason.`);
    try {
      new RegExp(suppressionSource(suppression.url));
    } catch {
      problems.push(`${at} has an invalid URL pattern.`);
    }
  }

  for (const finding of declaration.knownFindings ?? []) {
    if (!FINDING_ID.test(finding)) problems.push(`${who}: known finding ${JSON.stringify(finding)} is not of the form F<n>.`);
  }
  for (const name of declaration.requiresSeed ?? []) {
    if (isBlank(name)) problems.push(`${who}: requiresSeed contains a blank name.`);
  }
  return problems;
}

/** Throws one error listing every problem, or returns quietly for a valid declaration. */
export function assertValidDeclaration(declaration: DeclarationInput): void {
  const problems = declarationProblems(declaration);
  if (problems.length > 0) throw new Error(`Invalid Pathway declaration:\n  - ${problems.join('\n  - ')}`);
}

/**
 * The tags Playwright selects on (Req 35.3): `@id:<id> @area:<area> @kind:<kind>`, plus
 * `@aux` for a mock-provider Pathway (the aux projects grep for it) and `@isolated` when
 * set (the isolated project greps for it, every other project inverts it).
 */
export function pathwayTags(declaration: Pick<DeclarationInput, 'id' | 'area' | 'kind' | 'provider' | 'isolated'>): string[] {
  const tags = [`@id:${declaration.id}`, `@area:${declaration.area}`, `@kind:${declaration.kind}`];
  if (declaration.provider === 'mock') tags.push('@aux');
  if (declaration.isolated) tags.push('@isolated');
  return tags;
}

/**
 * True when a simulated step may use `mechanism` in this Pathway: the mock provider only
 * exists on the aux server, so `mock-provider` needs a mock Pathway; the other two
 * mechanisms run against the main server's real Stripe objects.
 */
export function mechanismAllowed(mechanism: SimMechanism, provider: DeclarationInput['provider']): boolean {
  return mechanism !== 'mock-provider' || provider === 'mock';
}

/**
 * The declaration as the `audit-pathway` record stores it: suppressions as pattern
 * sources, and each member as a description (`describeMember`) instead of the account
 * object, which carries a password.
 */
export function recordDeclaration(
  declaration: DeclarationInput,
  describeMember: (member: unknown) => string,
): PathwayDeclaration {
  const record: PathwayDeclaration = {
    id: declaration.id,
    title: declaration.title,
    area: declaration.area,
    kind: declaration.kind,
    provider: declaration.provider,
    members: Object.fromEntries(Object.entries(declaration.members).map(([label, m]) => [label, describeMember(m)])),
    viewports: declaration.viewports === 'both'
      ? 'both'
      : { only: declaration.viewports.only, reason: declaration.viewports.reason },
  };
  if (declaration.mockReason !== undefined) record.mockReason = declaration.mockReason;
  if (declaration.isolated) record.isolated = true;
  if (declaration.requiresSeed?.length) record.requiresSeed = [...declaration.requiresSeed];
  if (declaration.suppress?.length) {
    record.suppress = declaration.suppress.map((s): Suppression => ({
      check: s.check,
      url: suppressionSource(s.url),
      reason: s.reason,
    }));
  }
  if (declaration.knownFindings?.length) record.knownFindings = [...declaration.knownFindings];
  return record;
}
