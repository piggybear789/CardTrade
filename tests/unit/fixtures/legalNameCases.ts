// One table of cases for the disclosed legal name (ESC-25), shared by the buy-path
// disclosure test and the contract-room name test so the two copies cannot drift.

export interface LegalNameCase {
  name: string;
  identityCheckName: string | null;
  connectLegalName: string | null;
  identityGrandfatheredAt: string | null;
  expected: string | null;
}

export const LEGAL_NAME_CASES: readonly LegalNameCase[] = [
  {
    name: 'grandfathered with no Identity name discloses the Connect name',
    identityCheckName: null,
    connectLegalName: 'Jenny Rosen',
    identityGrandfatheredAt: '2026-01-01T00:00:00.000Z',
    expected: 'Jenny Rosen',
  },
  {
    name: 'not grandfathered with no Identity name discloses nothing',
    identityCheckName: null,
    connectLegalName: 'Typed Name',
    identityGrandfatheredAt: null,
    expected: null,
  },
  {
    name: 'an Identity name wins, grandfathered or not',
    identityCheckName: 'Jenny Rosen',
    connectLegalName: 'Someone Else',
    identityGrandfatheredAt: '2026-01-01T00:00:00.000Z',
    expected: 'Jenny Rosen',
  },
  {
    name: 'an Identity name is used for a non-grandfathered member',
    identityCheckName: 'Jenny Rosen',
    connectLegalName: null,
    identityGrandfatheredAt: null,
    expected: 'Jenny Rosen',
  },
];
