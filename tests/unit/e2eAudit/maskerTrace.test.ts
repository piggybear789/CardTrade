// tests/unit/e2eAudit/maskerTrace.test.ts
//
// Examples for the Masker's Node half (Req 32.1, 32.2): the trace-zip scrubber, the
// secret spellings it looks for, and the `unmasked` observation. The on-screen overlay
// needs a browser and is exercised by the Playwright harness.

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  crc32,
  entryData,
  readZip,
  scrubTraces,
  scrubTraceZip,
  secretVariants,
  unmaskedObservation,
  writeZip,
  type ZipEntry,
} from '../../e2e/audit/masker';

const SECRET = 'sk_test_abc"def/ghi+jkl';

function entry(name: string, data: Buffer, method: 0 | 8 = 8): ZipEntry {
  return {
    name,
    flags: 0x0800,
    method,
    dosTime: 0,
    dosDate: 0x21,
    crc32: crc32(data),
    raw: method === 8 ? deflateRawSync(data) : data,
    uncompressedSize: data.length,
  };
}

function texts(buffer: Buffer): Record<string, string> {
  return Object.fromEntries(readZip(buffer).map((e) => [e.name, entryData(e).toString('latin1')]));
}

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });
});

describe('secretVariants', () => {
  it('adds the JSON-escaped and percent-encoded spellings', () => {
    const variants = secretVariants([SECRET]);
    expect(variants).toContain(SECRET);
    expect(variants).toContain('sk_test_abc\\"def/ghi+jkl');
    expect(variants).toContain(encodeURIComponent(SECRET));
  });

  it('drops spellings shorter than the minimum', () => {
    expect(secretVariants(['short'])).toEqual([]);
  });
});

describe('scrubTraceZip', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'masker-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('rewrites text entries in every spelling and copies binary entries untouched', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]), Buffer.from(SECRET)]);
    const action = JSON.stringify({ method: 'fill', params: { value: SECRET } });
    const zip = writeZip([
      entry('trace.trace', Buffer.from(`${action}\n`)),
      entry('trace.network', Buffer.from(`{"url":"https://x.test/?k=${encodeURIComponent(SECRET)}"}`), 0),
      entry('resources/abc123', Buffer.from('<p>alice@example.com said hi</p>')),
      entry('resources/shot.png', png),
    ]);
    const file = path.join(dir, 'trace.zip');
    await writeFile(file, zip);

    const result = await scrubTraceZip(file, { secrets: [SECRET], pii: {} });
    expect(result).toMatchObject({ entries: 4, rewritten: 3 });

    const after = texts(await readFile(file));
    expect(after['trace.trace']).toContain('"value":"[MASKED]"');
    expect(after['trace.network']).toContain('?k=[MASKED]');
    expect(after['resources/abc123']).toBe('<p>a***@example.com said hi</p>');
    expect(after['resources/shot.png']).toBe(png.toString('latin1'));
    for (const text of Object.values(after).slice(0, 3)) expect(text).not.toContain('abc');
  });

  it('leaves a clean trace byte for byte', async () => {
    const zip = writeZip([entry('trace.trace', Buffer.from('{"type":"before"}\n'))]);
    const file = path.join(dir, 'clean.zip');
    await writeFile(file, zip);
    expect((await scrubTraceZip(file, { secrets: [SECRET] })).rewritten).toBe(0);
    expect((await readFile(file)).equals(zip)).toBe(true);
  });

  it('deletes a trace it cannot read and reports it without content', async () => {
    const file = path.join(dir, 'nested', 'broken.zip');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(`not a zip ${SECRET}`));

    const summary = await scrubTraces([dir, path.join(dir, 'missing')], { secrets: [SECRET] });
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0]).toMatchObject({ file, deleted: true });
    expect(summary.failed[0].error).not.toContain(SECRET);
    await expect(readFile(file)).rejects.toThrow();
  });
});

describe('unmaskedObservation', () => {
  const where = { member: 'seller', url: 'http://localhost:3100/deals' };

  it('is null when everything on screen was covered', () => {
    expect(
      unmaskedObservation({ installed: true, matches: 3, uncovered: 0, offscreen: 2, uncoveredByKind: {} }, where),
    ).toBeNull();
  });

  it('reports uncovered regions by kind, with counts only', () => {
    const observation = unmaskedObservation(
      { installed: true, matches: 3, uncovered: 2, offscreen: 0, uncoveredByKind: { email: 1, legalName: 1 } },
      where,
    );
    expect(observation).toMatchObject({
      check: 'unmasked',
      member: 'seller',
      detail: { uncovered: 2, 'uncovered.email': 1, 'uncovered.legalName': 1, installed: 1 },
    });
    expect(observation?.message).toContain('email 1, legalName 1');
  });

  it('flags a page the masker was injected into late', () => {
    const observation = unmaskedObservation(
      { installed: false, matches: 0, uncovered: 0, offscreen: 0, uncoveredByKind: {} },
      where,
    );
    expect(observation?.detail).toMatchObject({ installed: 0 });
  });
});
