// tests/unit/e2eAudit/members.test.ts
//
// The pure parts of `tests/e2e/audit/members.ts`: aux-server addresses, declaration
// validation, Persona legal names and project defaults. The context work itself is
// Playwright-only and is exercised by the suite.
//
// Requirements: 3.4, 6.6, 29.3

import { describe, expect, it } from 'vitest';

import {
  AUX_MEMBER_SLOTS_PER_WORKER,
  AUX_MEMBER_WORKER_BLOCKS,
  auxMemberAddress,
  personaLegalName,
  serverForProject,
  validateMemberDeclarations,
  videoSize,
  viewportForProject,
} from '../../e2e/audit/members';
import { ALICE, AUX_SIGN_IN_HOST_BASE, BOB, appServerUrl, persona } from '../../e2e/support/users';

function hostOf(address: string): number {
  const match = /^203\.0\.113\.(\d+)$/.exec(address);
  if (!match) throw new Error(`not a TEST-NET-3 address: ${address}`);
  return Number(match[1]);
}

describe('auxMemberAddress', () => {
  it('stays in TEST-NET-3 below the setup range for every worker and slot', () => {
    for (let worker = 0; worker < 64; worker += 1) {
      for (let slot = 0; slot < AUX_MEMBER_SLOTS_PER_WORKER * 2; slot += 1) {
        const host = hostOf(auxMemberAddress(worker, slot));
        expect(host).toBeGreaterThanOrEqual(1);
        expect(host).toBeLessThan(AUX_SIGN_IN_HOST_BASE);
      }
    }
  });

  it('gives concurrent workers disjoint blocks', () => {
    const owners = new Map<string, number>();
    for (let worker = 0; worker < AUX_MEMBER_WORKER_BLOCKS; worker += 1) {
      for (let slot = 0; slot < AUX_MEMBER_SLOTS_PER_WORKER; slot += 1) {
        const address = auxMemberAddress(worker, slot);
        expect(owners.get(address), address).toBeUndefined();
        owners.set(address, worker);
      }
    }
  });

  it('refuses a negative or fractional index', () => {
    expect(() => auxMemberAddress(-1, 0)).toThrow(RangeError);
    expect(() => auxMemberAddress(0, 1.5)).toThrow(RangeError);
  });
});

describe('validateMemberDeclarations', () => {
  it('accepts seed members, personas and guests under valid labels', () => {
    expect(() =>
      validateMemberDeclarations({ buyer: BOB, seller: ALICE, visitor: 'guest', newbie: persona('no-card-buyer') }),
    ).not.toThrow();
  });

  it('refuses an empty declaration and a label the artifact grammar cannot carry', () => {
    expect(() => validateMemberDeclarations({})).toThrow();
    expect(() => validateMemberDeclarations({ 'Buyer.1': BOB })).toThrow(RangeError);
  });

  it('refuses one account declared twice, which would replay one refresh token', () => {
    expect(() => validateMemberDeclarations({ buyer: BOB, seller: BOB })).toThrow(/same account/);
  });
});

describe('personaLegalName', () => {
  it('is the verified name the persona profile carries, and null when unverified', () => {
    expect(personaLegalName(persona('verified-seller', { identityVerified: true }))).toBe('E2E verified seller');
    expect(personaLegalName(persona('plain-buyer'))).toBeNull();
  });
});

describe('project defaults', () => {
  const project = (name: string, baseURL?: string) =>
    ({ project: { name, use: { baseURL } } }) as unknown as Parameters<typeof serverForProject>[0];

  it('reads the server from the project baseURL and the viewport from its name', () => {
    expect(serverForProject(project('desktop-aux', appServerUrl('aux')))).toBe('aux');
    expect(serverForProject(project('desktop', appServerUrl('main')))).toBe('main');
    expect(viewportForProject(project('phone-aux'))).toBe('phone');
    expect(viewportForProject(project('isolated'))).toBe('desktop');
  });

  it('records video at the context viewport', () => {
    expect(videoSize({ width: 390, height: 664 })).toEqual({ width: 390, height: 664 });
    expect(videoSize(null)).toEqual({ width: 1280, height: 720 });
  });
});
