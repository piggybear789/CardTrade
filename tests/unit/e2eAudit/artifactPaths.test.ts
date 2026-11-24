// tests/unit/e2eAudit/artifactPaths.test.ts
//
// Examples for the audit suite's artifact path grammar, superseded-run selection and
// Storage upload URL parsing (Req 2.4, 29.5, 29.6). The universal round-trip
// properties live in tests/property/e2eAudit/.

import { describe, expect, it } from 'vitest';
import {
  artifactPath,
  parseArtifactPath,
  parseRunDirectory,
  parseStorageUploadUrl,
  storageUploadUrl,
  supersededRuns,
  type ArtifactSpec,
} from '../../e2e/audit/core/artifactPaths';

const RUN_A = '2026-12-01T09-30-00Z-a1b2c3d';
const RUN_B = '2026-12-02T09-30-00Z-0f0f0f0';
const RUN_C = '2026-12-03T01-00-00Z-zzz';
const PATHWAY = 'journeys.cash-sale-lifecycle';

describe('artifactPath / parseArtifactPath', () => {
  const specs: Array<[ArtifactSpec, string]> = [
    [{ kind: 'step-screenshot', pathwayId: PATHWAY, viewport: 'phone', runId: RUN_A, step: 3, member: 'seller' },
      `audit-artifacts/${PATHWAY}/phone/${RUN_A}/step-03.seller.png`],
    [{ kind: 'video', pathwayId: PATHWAY, viewport: 'desktop', runId: RUN_A, member: 'buyer-2', n: 0 },
      `audit-artifacts/${PATHWAY}/desktop/${RUN_A}/video.buyer-2.0.webm`],
    [{ kind: 'trace', pathwayId: PATHWAY, viewport: 'desktop', runId: RUN_A },
      `audit-artifacts/${PATHWAY}/desktop/${RUN_A}/trace.zip`],
    [{ kind: 'console', pathwayId: PATHWAY, viewport: 'phone', runId: RUN_A, member: 'guest' },
      `audit-artifacts/${PATHWAY}/phone/${RUN_A}/console.guest.jsonl`],
    [{ kind: 'manifest', runId: RUN_A }, `audit-artifacts/runs/${RUN_A}/manifest.json`],
    [{ kind: 'uploads', runId: RUN_A }, `audit-artifacts/.uploads/${RUN_A}.jsonl`],
  ];

  it.each(specs)('writes the design grammar and parses it back (%o)', (spec, expected) => {
    expect(artifactPath(spec)).toBe(expected);
    expect(parseArtifactPath(expected)).toEqual(spec);
  });

  it('pads the step to two digits and keeps longer indices', () => {
    expect(artifactPath({ kind: 'step-screenshot', pathwayId: PATHWAY, viewport: 'phone', runId: RUN_A, step: 123, member: 'a' }))
      .toMatch(/step-123\.a\.png$/);
  });

  it('accepts backslashes and an absolute prefix', () => {
    const path = `C:\\dev\\Marketplace\\audit-artifacts\\${PATHWAY}\\phone\\${RUN_A}\\step-01.seller.png`;
    expect(parseArtifactPath(path)).toMatchObject({ kind: 'step-screenshot', step: 1, member: 'seller' });
  });

  it('refuses non-canonical and unknown names', () => {
    const dir = `audit-artifacts/${PATHWAY}/phone/${RUN_A}`;
    expect(parseArtifactPath(`${dir}/step-003.seller.png`)).toBeNull();
    expect(parseArtifactPath(`${dir}/step-00.seller.png`)).toBeNull();
    expect(parseArtifactPath(`${dir}/video.seller.01.webm`)).toBeNull();
    expect(parseArtifactPath(`${dir}/step-01.Seller.png`)).toBeNull();
    expect(parseArtifactPath(`${dir}/notes.txt`)).toBeNull();
    expect(parseArtifactPath(`audit-artifacts/${PATHWAY}/tablet/${RUN_A}/trace.zip`)).toBeNull();
    expect(parseArtifactPath('somewhere/else/trace.zip')).toBeNull();
  });

  it('throws on a component that would not parse back', () => {
    expect(() => artifactPath({ kind: 'console', pathwayId: PATHWAY, viewport: 'phone', runId: RUN_A, member: 'a.b' }))
      .toThrow(RangeError);
    expect(() => artifactPath({ kind: 'trace', pathwayId: 'nodot', viewport: 'phone', runId: RUN_A })).toThrow(RangeError);
    expect(() => artifactPath({ kind: 'step-screenshot', pathwayId: PATHWAY, viewport: 'phone', runId: RUN_A, step: 0, member: 'a' }))
      .toThrow(RangeError);
  });
});

describe('supersededRuns', () => {
  const dirs = [
    `audit-artifacts/${PATHWAY}/phone/${RUN_B}`,
    `audit-artifacts/${PATHWAY}/phone/${RUN_A}`,
    `audit-artifacts/${PATHWAY}/phone/${RUN_C}`,
    `audit-artifacts/${PATHWAY}/desktop/${RUN_A}`,
    `audit-artifacts/other.pathway/phone/${RUN_A}`,
    `audit-artifacts/runs/${RUN_A}`,
    `audit-artifacts/${PATHWAY}/phone/keep-me`,
  ];

  it('returns only the pair\'s older runs, oldest first', () => {
    expect(supersededRuns(dirs, PATHWAY, 'phone')).toEqual([
      `audit-artifacts/${PATHWAY}/phone/${RUN_A}`,
      `audit-artifacts/${PATHWAY}/phone/${RUN_B}`,
    ]);
  });

  it('never returns a pair\'s only run', () => {
    expect(supersededRuns(dirs, PATHWAY, 'desktop')).toEqual([]);
    expect(supersededRuns([], PATHWAY, 'desktop')).toEqual([]);
  });

  it('parses run directories only', () => {
    expect(parseRunDirectory(`audit-artifacts/runs/${RUN_A}`)).toBeNull();
    expect(parseRunDirectory(`audit-artifacts/${PATHWAY}/phone/${RUN_A}`))
      .toEqual({ pathwayId: PATHWAY, viewport: 'phone', runId: RUN_A });
  });
});

describe('storageUploadUrl / parseStorageUploadUrl', () => {
  const base = 'https://abc.supabase.co/';

  it('round-trips a bucket and path, including characters that need encoding', () => {
    const url = storageUploadUrl(base, 'item-images', 'profile-1/my photo #1.png');
    expect(url).toBe('https://abc.supabase.co/storage/v1/object/item-images/profile-1/my%20photo%20%231.png');
    expect(parseStorageUploadUrl(url, 'POST')).toEqual({ bucket: 'item-images', path: 'profile-1/my photo #1.png' });
  });

  it('reads the signed-upload form and ignores the query', () => {
    expect(parseStorageUploadUrl(`${base}storage/v1/object/upload/sign/message-attachments/u1/a.jpg?token=x`, 'PUT'))
      .toEqual({ bucket: 'message-attachments', path: 'u1/a.jpg' });
  });

  it('gives nothing for any other URL or method', () => {
    expect(parseStorageUploadUrl(`${base}storage/v1/object/item-images/a.png`, 'GET')).toBeNull();
    expect(parseStorageUploadUrl(`${base}storage/v1/object/public/item-images/a.png`)).toBeNull();
    expect(parseStorageUploadUrl(`${base}storage/v1/object/sign/item-images/a.png`)).toBeNull();
    expect(parseStorageUploadUrl(`${base}storage/v1/object/list/item-images`)).toBeNull();
    expect(parseStorageUploadUrl(`${base}storage/v1/object/item-images`)).toBeNull();
    expect(parseStorageUploadUrl(`${base}storage/v1/object/item-images/a%2Fb.png`)).toBeNull();
    expect(parseStorageUploadUrl(`${base}rest/v1/items`)).toBeNull();
    expect(parseStorageUploadUrl('not a url')).toBeNull();
  });
});
