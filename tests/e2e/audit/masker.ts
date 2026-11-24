// tests/e2e/audit/masker.ts
//
// THE MASKER for the e2e UX audit suite: the Playwright and file-system half of the
// rules in `core/mask.ts`. Three parts, one list of what is sensitive:
//
//   1. An INIT SCRIPT (`installMasker`) that draws opaque boxes over emails, Stripe
//      client secrets, invite tokens, deal QR codes and the run's legal names. The
//      boxes live in a fixed-position overlay inside a CLOSED shadow root that is
//      `aria-hidden` and `pointer-events: none`, and are re-measured on mutation,
//      scroll, resize and the end of every animation. The page's DOM text is never
//      changed, so assertions read real text while the video shows the boxes.
//   2. SCREENSHOT SUPPORT (`prepareScreenshot`): the `mask` locator list Playwright
//      paints over (it also covers what a full-page screenshot scrolls into view), and
//      a coverage check whose uncovered-match count becomes a blocking `unmasked`
//      observation.
//   3. A TRACE SCRUBBER (`scrubTraces`) that rewrites every text entry of every trace
//      zip through `scrubText`. `globalTeardown` calls it after cleanup.
//
// Requirements:
//   32.1  secret env values are replaced with `[MASKED]` in traces (and, through
//         `scrubberFor`, in the logs the reporter and console capture write)
//   32.2  on-screen emails, client secrets, invite tokens and full legal names are
//         covered in screenshots and video
//
// Secret values never leave this module: results carry counts and file names only.

import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

import type { BrowserContext, Locator, Page } from '@playwright/test';

import {
  MASK_PLACEHOLDER,
  MIN_SECRET_LENGTH,
  piiMatchers,
  scrubText,
  secretValues,
  type PiiKind,
  type PiiOptions,
} from './core/mask';
import type { RawObservation } from './core/uxPolicy';

// ---------------------------------------------------------------------------
// What to cover
// ---------------------------------------------------------------------------

/**
 * Elements covered whole, whatever their text. The deal QR code encodes the invite
 * link, so it is as sensitive as the token printed beside it; the link field holds the
 * token in an input `value`, which the text walk would otherwise only see as a value
 * match. `[data-audit-mask]` is an opt-in for anything a Pathway wants hidden.
 */
export const MASK_SELECTORS: readonly string[] = [
  '[data-audit-mask]',
  'svg[aria-label="QR code for the deal link"]',
  'button[aria-label="Show a larger QR code"]',
  'input[aria-label="Deal link"]',
  'input[aria-labelledby="deal-link-label"]',
];

/**
 * The attribute `prepareScreenshot` puts on matched elements for the duration of one
 * screenshot, so Playwright's `mask` can name them. It is an attribute, never text, it
 * is added only after the page has loaded (so it cannot upset hydration), and
 * `clearMaskMarks` removes it again.
 */
export const MASK_HIT_ATTRIBUTE = 'data-audit-masked';

/** The global the init script registers its API under (non-enumerable). */
const PAGE_API = '__nodittoAuditMask';

/** The overlay's host element name. */
const HOST_TAG = 'noditto-audit-mask';

/** Options for the on-screen masker. */
export interface MaskerOptions {
  /** Full legal names of the run's members: seed names plus personas' `identity_check_name`. */
  legalNames?: readonly string[];
  /** Extra selectors to cover whole, added to `MASK_SELECTORS`. */
  selectors?: readonly string[];
  /** Box colour. Defaults to near-black, which reads as deliberate in a video. */
  color?: string;
}

/** What the page-side coverage check reports. Counts only; never the matched text. */
export interface MaskCheck {
  /** False when the init script was not present and had to be injected late. */
  installed: boolean;
  /** Matched regions found on the page (text ranges, input values and selector hits). */
  matches: number;
  /** In-viewport regions the overlay is NOT the topmost thing over. */
  uncovered: number;
  /** Regions entirely outside the viewport; covered in screenshots by `mask` only. */
  offscreen: number;
  /** Uncovered regions by kind (`email`, `clientSecret`, `inviteToken`, `legalName`, `selector`). */
  uncoveredByKind: Record<string, number>;
}

/** The serialisable configuration the page script receives. */
interface PageConfig {
  matchers: Array<{ kind: PiiKind; source: string; flags: string }>;
  selectors: string[];
  hitAttribute: string;
  api: string;
  hostTag: string;
  color: string;
}

function pageConfig(options: MaskerOptions): PageConfig {
  return {
    matchers: piiMatchers({ legalNames: options.legalNames ?? [] }).map(({ kind, pattern }) => ({
      kind,
      source: pattern.source,
      flags: pattern.flags,
    })),
    selectors: [...new Set([...MASK_SELECTORS, ...(options.selectors ?? [])])],
    hitAttribute: MASK_HIT_ATTRIBUTE,
    api: PAGE_API,
    hostTag: HOST_TAG,
    color: options.color ?? '#111',
  };
}

// ---------------------------------------------------------------------------
// The page script
// ---------------------------------------------------------------------------

// Written as plain JavaScript in a string rather than a TypeScript function passed to
// `addInitScript`: a function is serialised with `toString()`, and a transpiler that
// injects helpers (`__name` under esbuild's keepNames) breaks it in the page. A string
// runs the same under every loader.
const PAGE_SCRIPT = String.raw`
(function (config) {
  if (window[config.api]) return;
  var PAD = 2;
  var matchers = config.matchers.map(function (m) { return { kind: m.kind, re: new RegExp(m.source, m.flags) }; });
  var selectorList = config.selectors.join(', ');
  var host = null, layer = null, pool = [], scheduled = false, lastRegions = [];

  // The host goes at the END of <body>, never on <html>: React 19 hydration skips an
  // unexpected trailing node in <body> (it has to, for browser extensions), and the
  // maximum z-index keeps it above portals appended after it.
  function ensureHost() {
    var parent = document.body;
    if (!parent) return false;
    if (!host) {
      host = document.createElement(config.hostTag);
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483647;';
      var root = host.attachShadow({ mode: 'closed' });
      var style = document.createElement('style');
      style.textContent = '.b{position:fixed;display:block;margin:0;padding:0;border:0;border-radius:2px;background:' + config.color + ';pointer-events:none;}' +
        ':host([data-probe]) .b{pointer-events:auto;}';
      layer = document.createElement('div');
      root.appendChild(style);
      root.appendChild(layer);
    }
    if (host.parentNode !== parent) parent.appendChild(host);
    return true;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (typeof el.checkVisibility === 'function') return el.checkVisibility({ visibilityProperty: true });
    var s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden';
  }

  function pushRect(out, kind, el, r) {
    if (r.width <= 0 || r.height <= 0) return;
    out.push({ kind: kind, el: el, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  }

  function textMatches(text) {
    var hits = [];
    for (var i = 0; i < matchers.length; i++) {
      var re = matchers[i].re;
      re.lastIndex = 0;
      var m;
      while ((m = re.exec(text)) !== null) {
        if (m[0] === '') { re.lastIndex++; continue; }
        hits.push({ kind: matchers[i].kind, start: m.index, end: m.index + m[0].length });
      }
    }
    return hits;
  }

  function collect() {
    var regions = [];
    var body = document.body;
    if (!body) return regions;
    var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var p = node.parentElement;
        if (!p || !node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (p.closest('script,style,noscript,template')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var node;
    while ((node = walker.nextNode())) {
      var hits = textMatches(node.nodeValue);
      if (hits.length === 0 || !isVisible(node.parentElement)) continue;
      for (var h = 0; h < hits.length; h++) {
        var range = document.createRange();
        range.setStart(node, hits[h].start);
        range.setEnd(node, hits[h].end);
        var rects = range.getClientRects();
        for (var r = 0; r < rects.length; r++) pushRect(regions, hits[h].kind, node.parentElement, rects[r]);
      }
    }
    var fields = document.querySelectorAll('input, textarea');
    for (var f = 0; f < fields.length; f++) {
      var field = fields[f];
      var type = (field.getAttribute('type') || '').toLowerCase();
      if (type === 'password' || type === 'hidden') continue;
      var valueHits = field.value ? textMatches(field.value) : [];
      if (valueHits.length === 0 || !isVisible(field)) continue;
      pushRect(regions, valueHits[0].kind, field, field.getBoundingClientRect());
    }
    if (selectorList) {
      var whole = document.querySelectorAll(selectorList);
      for (var w = 0; w < whole.length; w++) {
        if (isVisible(whole[w])) pushRect(regions, 'selector', whole[w], whole[w].getBoundingClientRect());
      }
    }
    return regions;
  }

  function draw(regions) {
    if (!ensureHost()) return;
    while (pool.length < regions.length) {
      var box = document.createElement('div');
      box.className = 'b';
      layer.appendChild(box);
      pool.push(box);
    }
    for (var i = 0; i < pool.length; i++) {
      var b = pool[i];
      if (i >= regions.length) { b.style.display = 'none'; continue; }
      var g = regions[i];
      b.style.display = 'block';
      b.style.left = (g.left - PAD) + 'px';
      b.style.top = (g.top - PAD) + 'px';
      b.style.width = (g.right - g.left + PAD * 2) + 'px';
      b.style.height = (g.bottom - g.top + PAD * 2) + 'px';
    }
  }

  function refresh() {
    scheduled = false;
    lastRegions = collect();
    draw(lastRegions);
    return lastRegions;
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(refresh);
  }

  // True when the overlay is the topmost hit at (x, y). The boxes are made hit-testable
  // for the duration of the probe only, synchronously, so nothing is painted in between.
  function coveredAt(x, y) {
    var top = document.elementFromPoint(x, y);
    return top === host;
  }

  function check() {
    var regions = refresh();
    var vw = window.innerWidth, vh = window.innerHeight;
    var result = { installed: true, matches: regions.length, uncovered: 0, offscreen: 0, uncoveredByKind: {} };
    if (!host) return result;
    host.setAttribute('data-probe', '');
    try {
      for (var i = 0; i < regions.length; i++) {
        var g = regions[i];
        var left = Math.max(g.left, 0), right = Math.min(g.right, vw);
        var top = Math.max(g.top, 0), bottom = Math.min(g.bottom, vh);
        if (right <= left || bottom <= top) { result.offscreen++; continue; }
        var ix = Math.min(1, (right - left) / 4), iy = Math.min(1, (bottom - top) / 4);
        var points = [
          [(left + right) / 2, (top + bottom) / 2],
          [left + ix, top + iy], [right - ix, top + iy],
          [left + ix, bottom - iy], [right - ix, bottom - iy]
        ];
        var ok = true;
        for (var p = 0; p < points.length && ok; p++) ok = coveredAt(points[p][0], points[p][1]);
        if (!ok) {
          result.uncovered++;
          result.uncoveredByKind[g.kind] = (result.uncoveredByKind[g.kind] || 0) + 1;
        }
      }
    } finally {
      host.removeAttribute('data-probe');
    }
    return result;
  }

  function unmark() {
    var marked = document.querySelectorAll('[' + config.hitAttribute + ']');
    for (var i = 0; i < marked.length; i++) marked[i].removeAttribute(config.hitAttribute);
  }

  function mark() {
    unmark();
    var regions = refresh();
    var seen = new Set();
    for (var i = 0; i < regions.length; i++) {
      var el = regions[i].el;
      if (seen.has(el)) continue;
      seen.add(el);
      el.setAttribute(config.hitAttribute, '');
    }
    return seen.size;
  }

  var observer = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      if (rec.target === host) continue;
      if (rec.type === 'attributes' && (rec.attributeName === config.hitAttribute || rec.attributeName === 'data-probe')) continue;
      schedule();
      return;
    }
  });
  observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  window.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  document.addEventListener('transitionend', schedule, true);
  document.addEventListener('animationend', schedule, true);
  // Animations without an end event (a progress bar, a scroll-linked effect) still
  // move text; a slow sweep catches them.
  setInterval(schedule, 500);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule);
  schedule();

  Object.defineProperty(window, config.api, {
    value: Object.freeze({ check: check, mark: mark, unmark: unmark }),
    enumerable: false,
    configurable: false,
    writable: false
  });
})`;

/** The init script source for `options`: the page script applied to its configuration. */
export function maskerInitScript(options: MaskerOptions = {}): string {
  return `${PAGE_SCRIPT}(${JSON.stringify(pageConfig(options))});`;
}

/**
 * Installs the on-screen masker in every page and frame `context` opens from now on
 * (Req 32.2). Call it before the first page loads, so the very first video frame is
 * already covered; `prepareScreenshot` injects it late, and reports that, if a page
 * slipped through.
 */
export async function installMasker(context: BrowserContext, options: MaskerOptions = {}): Promise<void> {
  await context.addInitScript({ content: maskerInitScript(options) });
}

async function ensurePageScript(page: Page, options: MaskerOptions): Promise<boolean> {
  const present = await page.evaluate((api) => api in window, PAGE_API);
  if (present) return true;
  await page.evaluate(maskerInitScript(options));
  return false;
}

/**
 * Re-measures the overlay now and reports how many matched regions it fails to cover
 * in the viewport. A region counts as uncovered when anything other than the overlay
 * is the topmost element at its centre or near its corners: a stale box, a native
 * top-layer `<dialog>` or popover, or a missing overlay.
 */
export async function checkMask(page: Page, options: MaskerOptions = {}): Promise<MaskCheck> {
  const installed = await ensurePageScript(page, options);
  const result = await page.evaluate((api) => {
    const masker = (window as unknown as Record<string, { check(): Omit<MaskCheck, 'installed'> }>)[api];
    return masker.check();
  }, PAGE_API);
  return { ...result, installed };
}

/**
 * Marks every matched element with `MASK_HIT_ATTRIBUTE` and returns the locators to
 * pass to `page.screenshot({ mask })`. Call `clearMaskMarks` after the screenshot.
 */
export async function maskLocators(page: Page, options: MaskerOptions = {}): Promise<Locator[]> {
  await ensurePageScript(page, options);
  await page.evaluate((api) => {
    const masker = (window as unknown as Record<string, { mark(): number }>)[api];
    masker.mark();
  }, PAGE_API);
  const selectors = pageConfig(options).selectors;
  return [page.locator(`[${MASK_HIT_ATTRIBUTE}]`), ...selectors.map((selector) => page.locator(selector))];
}

/** Removes the marks `maskLocators` added. Safe on a page that has navigated or closed. */
export async function clearMaskMarks(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await page
    .evaluate((api) => {
      const masker = (window as unknown as Record<string, { unmark(): void } | undefined>)[api];
      masker?.unmark();
    }, PAGE_API)
    .catch(() => undefined);
}

/**
 * The blocking `unmasked` observation for a coverage check, or null when every
 * in-viewport match was covered and the masker was installed from the start. Carries
 * counts only, never the matched text; `url` must already be scrubbed.
 */
export function unmaskedObservation(check: MaskCheck, where: { member: string; url: string }): RawObservation | null {
  if (check.installed && check.uncovered === 0) return null;
  const kinds = Object.entries(check.uncoveredByKind)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => `${kind} ${count}`)
    .join(', ');
  const message = !check.installed
    ? `The masker was not installed before this page loaded, so its video is unmasked up to this step${check.uncovered > 0 ? `; ${check.uncovered} region(s) also uncovered (${kinds})` : ''}.`
    : `${check.uncovered} sensitive region(s) on screen not covered by the masker (${kinds}).`;
  const detail: Record<string, string | number> = {
    uncovered: check.uncovered,
    matches: check.matches,
    offscreen: check.offscreen,
    installed: check.installed ? 1 : 0,
  };
  for (const [kind, count] of Object.entries(check.uncoveredByKind)) detail[`uncovered.${kind}`] = count;
  return { check: 'unmasked', member: where.member, url: where.url, message, detail };
}

/** What `prepareScreenshot` hands the step runner. */
export interface ScreenshotMask {
  /** Pass to `page.screenshot({ mask })`. */
  mask: Locator[];
  /** Pass to `page.screenshot({ maskColor })`, so screenshots match the video. */
  maskColor: string;
  check: MaskCheck;
  /** A blocking `unmasked` reading, or null. Classify it with `classifyObservation`. */
  observation: RawObservation | null;
}

/**
 * Everything a step needs before `page.screenshot` (Req 32.2): the coverage check, the
 * `unmasked` observation it implies, and the `mask` locator list. The observation's URL
 * is the page URL scrubbed of secrets and PII. Call `clearMaskMarks` afterwards.
 */
export async function prepareScreenshot(
  page: Page,
  where: { member: string },
  options: MaskerOptions = {},
): Promise<ScreenshotMask> {
  const check = await checkMask(page, options);
  const scrub = scrubberFor(process.env, { legalNames: options.legalNames ?? [] });
  const observation = unmaskedObservation(check, { member: where.member, url: scrub(page.url()) });
  const mask = await maskLocators(page, options);
  return { mask, maskColor: options.color ?? '#111', check, observation };
}

// ---------------------------------------------------------------------------
// Text scrubbing for logs and traces
// ---------------------------------------------------------------------------

/**
 * The spellings a secret takes in a text artifact: as is, JSON-escaped (a trace's
 * action parameters and network bodies are JSON) and percent-encoded (a query string).
 * Spellings shorter than `MIN_SECRET_LENGTH` are dropped, matching `scrubText`.
 */
export function secretVariants(secrets: readonly string[]): string[] {
  const out = new Set<string>();
  for (const value of secrets) {
    for (const variant of [value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value)]) {
      if (variant.length >= MIN_SECRET_LENGTH) out.add(variant);
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/**
 * A scrubber for one run: every secret value in `env` (in each spelling
 * `secretVariants` lists) becomes `[MASKED]`, and with `pii` emails, client secrets,
 * invite tokens and legal names are masked too. The reporter, console capture and
 * network capture pass every string through it before writing (Req 32.1).
 */
export function scrubberFor(env: Record<string, string | undefined>, pii?: PiiOptions): (text: string) => string {
  const secrets = secretVariants(secretValues(env));
  return (text) => scrubText(text, secrets, pii);
}

// ---------------------------------------------------------------------------
// Trace zips
// ---------------------------------------------------------------------------

/** One entry of a zip archive, as read by `readZip`. */
export interface ZipEntry {
  name: string;
  /** General-purpose flags from the central directory (bit 11 = UTF-8 name). */
  flags: number;
  /** 0 stored, 8 deflate. */
  method: number;
  dosTime: number;
  dosDate: number;
  crc32: number;
  /** The entry's bytes exactly as stored, compressed when `method` is 8. */
  raw: Buffer;
  uncompressedSize: number;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE), as zip stores it. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Reads a zip archive from its central directory. Strict on purpose: zip64, encryption,
 * multi-disk archives and compression methods other than stored and deflate throw
 * rather than being skipped, because a trace the scrubber cannot read is a trace it
 * cannot vouch for.
 */
export function readZip(buffer: Buffer): ZipEntry[] {
  const minEnd = Math.max(0, buffer.length - 22 - 0xffff);
  let end = -1;
  for (let i = buffer.length - 22; i >= minEnd; i -= 1) {
    if (buffer.readUInt32LE(i) === SIG_END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('readZip: no end-of-central-directory record');
  const disk = buffer.readUInt16LE(end + 4);
  const count = buffer.readUInt16LE(end + 10);
  const cdSize = buffer.readUInt32LE(end + 12);
  const cdOffset = buffer.readUInt32LE(end + 16);
  if (disk !== 0) throw new Error('readZip: multi-disk archives are not supported');
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error('readZip: zip64 archives are not supported');
  }

  const entries: ZipEntry[] = [];
  let at = cdOffset;
  for (let n = 0; n < count; n += 1) {
    if (buffer.readUInt32LE(at) !== SIG_CENTRAL) throw new Error('readZip: corrupt central directory');
    const flags = buffer.readUInt16LE(at + 8);
    const method = buffer.readUInt16LE(at + 10);
    const dosTime = buffer.readUInt16LE(at + 12);
    const dosDate = buffer.readUInt16LE(at + 14);
    const crc = buffer.readUInt32LE(at + 16);
    const compressedSize = buffer.readUInt32LE(at + 20);
    const uncompressedSize = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const localOffset = buffer.readUInt32LE(at + 42);
    const name = buffer.toString(flags & 0x0800 ? 'utf8' : 'latin1', at + 46, at + 46 + nameLength);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error(`readZip: zip64 entry ${name} is not supported`);
    }
    if (flags & 0x0001) throw new Error(`readZip: encrypted entry ${name} is not supported`);
    if (method !== 0 && method !== 8) throw new Error(`readZip: entry ${name} uses unsupported method ${method}`);
    if (buffer.readUInt32LE(localOffset) !== SIG_LOCAL) throw new Error(`readZip: corrupt local header for ${name}`);
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    if (raw.length !== compressedSize) throw new Error(`readZip: truncated entry ${name}`);
    entries.push({ name, flags, method, dosTime, dosDate, crc32: crc, raw, uncompressedSize });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The uncompressed bytes of an entry, checked against its CRC. */
export function entryData(entry: ZipEntry): Buffer {
  const data = entry.method === 8 ? inflateRawSync(entry.raw) : Buffer.from(entry.raw);
  if (data.length !== entry.uncompressedSize || crc32(data) !== entry.crc32) {
    throw new Error(`readZip: checksum mismatch in ${entry.name}`);
  }
  return data;
}

/** An entry whose content is `data`, deflated, keeping the original name and timestamp. */
export function replaceEntryData(entry: ZipEntry, data: Buffer): ZipEntry {
  return {
    ...entry,
    flags: entry.flags & 0x0800,
    method: 8,
    crc32: crc32(data),
    raw: deflateRawSync(data),
    uncompressedSize: data.length,
  };
}

/** Writes entries as a zip archive: no data descriptors, no extra fields, no zip64. */
export function writeZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const flags = entry.flags & 0x0800;
    const name = Buffer.from(entry.name, flags ? 'utf8' : 'latin1');
    if (entry.raw.length >= 0xffffffff || entry.uncompressedSize >= 0xffffffff || offset >= 0xffffffff) {
      throw new Error(`writeZip: ${entry.name} needs zip64, which is not supported`);
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(entry.method, 8);
    local.writeUInt16LE(entry.dosTime, 10);
    local.writeUInt16LE(entry.dosDate, 12);
    local.writeUInt32LE(entry.crc32, 14);
    local.writeUInt32LE(entry.raw.length, 18);
    local.writeUInt32LE(entry.uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, entry.raw);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(entry.method, 10);
    central.writeUInt16LE(entry.dosTime, 12);
    central.writeUInt16LE(entry.dosDate, 14);
    central.writeUInt32LE(entry.crc32, 16);
    central.writeUInt32LE(entry.raw.length, 20);
    central.writeUInt32LE(entry.uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += 30 + name.length + entry.raw.length;
  }
  const cdSize = centrals.reduce((sum, part) => sum + part.length, 0);
  if (entries.length >= 0xffff || offset >= 0xffffffff) throw new Error('writeZip: archive needs zip64');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_END, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** Entry extensions that are never text: screencast frames, screenshots, fonts, media. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.ico', '.bmp',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.webm', '.mp4', '.mp3', '.wav', '.ogg',
  '.zip', '.gz', '.br', '.wasm', '.pdf',
]);

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/**
 * The entry's text, or null when it is binary. Anything with a binary extension is
 * binary; anything else (`trace.trace`, `trace.network`, `*.stacks`, extension-less
 * `resources/<sha1>` bodies and DOM snapshots) is text when it decodes as strict UTF-8
 * with no NUL byte.
 */
function entryText(name: string, data: Buffer): string | null {
  if (BINARY_EXTENSIONS.has(path.posix.extname(name).toLowerCase())) return null;
  if (data.includes(0)) return null;
  try {
    return UTF8.decode(data);
  } catch {
    return null;
  }
}

/** What to scrub a trace with. */
export interface TraceScrubOptions {
  /** Secret values, e.g. `secretValues(process.env)`. Their JSON and URL spellings are added. */
  secrets: readonly string[];
  /** PII to mask as well (emails, client secrets, invite tokens, legal names). */
  pii?: PiiOptions;
}

/** The outcome for one trace zip. Counts only. */
export interface TraceScrubResult {
  file: string;
  entries: number;
  /** Text entries whose content changed. */
  rewritten: number;
}

/**
 * Rewrites every text entry of one trace zip through `scrubText` (Req 32.1): action
 * parameters such as `fill` values, network bodies and DOM snapshots. Binary entries
 * and unchanged entries are copied byte for byte. The new archive is written beside the
 * old one and renamed over it, so an interrupted run never leaves half a trace. A file
 * that needed no change is not rewritten.
 *
 * @throws when the archive cannot be read (see `readZip`)
 */
export async function scrubTraceZip(file: string, options: TraceScrubOptions): Promise<TraceScrubResult> {
  const secrets = secretVariants(options.secrets);
  const entries = readZip(await fs.readFile(file));
  let rewritten = 0;
  const out = entries.map((entry) => {
    if (entry.name.endsWith('/')) return entry;
    const data = entryData(entry);
    const text = entryText(entry.name, data);
    if (text === null) return entry;
    const scrubbed = scrubText(text, secrets, options.pii);
    if (scrubbed === text) return entry;
    rewritten += 1;
    return replaceEntryData(entry, Buffer.from(scrubbed, 'utf8'));
  });
  if (rewritten > 0) {
    const temp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(temp, writeZip(out));
    await fs.rename(temp, file);
  }
  return { file, entries: entries.length, rewritten };
}

async function findZips(root: string): Promise<string[]> {
  const found: string[] = [];
  let names: import('node:fs').Dirent[];
  try {
    names = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return found;
    throw error;
  }
  for (const entry of names) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...(await findZips(full)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.zip')) found.push(full);
  }
  return found;
}

/** The outcome of scrubbing every trace under some roots. */
export interface TraceScrubSummary {
  scrubbed: TraceScrubResult[];
  /**
   * Traces that could not be read. Each was DELETED (unless `keepUnreadable`), because
   * a trace the scrubber cannot read may hold a secret no later check can see inside
   * its compressed bytes.
   */
  failed: Array<{ file: string; error: string; deleted: boolean }>;
}

/**
 * Scrubs every `*.zip` under each root (`test-results`, `audit-artifacts`), for
 * `globalTeardown` after cleanup (Req 32.1). Missing roots are skipped. A failure is
 * reported with the file and the reader's message, never the content.
 */
export async function scrubTraces(
  roots: readonly string[],
  options: TraceScrubOptions & { keepUnreadable?: boolean },
): Promise<TraceScrubSummary> {
  const summary: TraceScrubSummary = { scrubbed: [], failed: [] };
  for (const root of roots) {
    for (const file of await findZips(root)) {
      try {
        summary.scrubbed.push(await scrubTraceZip(file, options));
      } catch (error) {
        const message = scrubText(error instanceof Error ? error.message : String(error), secretVariants(options.secrets));
        let deleted = false;
        if (!options.keepUnreadable) {
          deleted = await fs.rm(file, { force: true }).then(() => true, () => false);
        }
        summary.failed.push({ file, error: message, deleted });
      }
    }
  }
  return summary;
}

/** Re-exported so callers of the Masker need one import. */
export { MASK_PLACEHOLDER };
