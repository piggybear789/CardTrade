// tests/e2e/audit/ux/cls.ts
//
// THE LAYOUT SHIFT COLLECTOR: the in-page half of `core/cls.ts`. The observer moved here
// from `specs/layout-shift.spec.ts` and now runs on every step of every Pathway.
//
// An init script installs, before any page script runs:
//
//   * a `PerformanceObserver('layout-shift')` (buffered, so shifts before the observer
//     attached on a fresh document are still seen) that records every entry's value,
//     `hadRecentInput`, `startTime` and the nodes it moved, as `NodeRef`s;
//   * a `MutationObserver` that remembers, for 2 s, which block container each mutation
//     landed in, so each shift carries the regions mutated in the `MUTATION_WINDOW_MS`
//     (500 ms) before it. That is what lets `shiftOutsideRegion` tell "the list grew"
//     from "the list grew and pushed the footer".
//
// `readShifts` returns the entries since the last `resetShifts` (the DSL resets at the
// start of each step); `clsObservations` hands them to `summariseShifts` and
// `shiftOutsideRegionFindings`. Entries with recent input are KEPT in the reading and
// skipped by the pure rules, exactly as CLS itself excludes them.
//
// WebKit has no `layout-shift` entries: there the reading is `supported: false` and
// produces no observation, which is the honest answer rather than a fake zero.
//
// Requirements:
//   30.1  a step's cumulative layout shift is recorded, with a UX_Observation when it
//         exceeds 0.1 or when an element outside the arriving data's region moves

import type { BrowserContext, Page } from '@playwright/test';

import {
  MUTATION_WINDOW_MS,
  shiftOutsideRegionFindings,
  summariseShifts,
  type LayoutShiftEntry,
} from '../core/cls';
import type { RawObservation } from '../core/uxPolicy';
import { DOM_HELPERS, apiCall, apiGuard, apiPublish, type ObservationWhere } from './pageSnippets';

const API = '__nodittoAuditCls';

/** Entries kept per document; a page that shifts more than this is reported anyway. */
const MAX_ENTRIES = 300;

/** What `readShifts` returns for one page. */
export interface ShiftReading {
  /** False when the engine has no `layout-shift` entries (WebKit). */
  supported: boolean;
  entries: LayoutShiftEntry[];
}

const PAGE_SCRIPT = String.raw`
(function () {
  if (window.top !== window) return;
  ${apiGuard(API)}
  ${DOM_HELPERS}
  var WINDOW_MS = ${MUTATION_WINDOW_MS};
  var KEEP_MS = 2000;
  var MAX = ${MAX_ENTRIES};
  var entries = [];
  var mutations = [];
  var supported = false;

  function blockContainer(node) {
    var el = node && node.nodeType === 1 ? node : node && node.parentElement;
    while (el && el !== document.documentElement) {
      var display = getComputedStyle(el).display;
      if (display && display.indexOf('inline') !== 0 && display !== 'contents') return el;
      el = el.parentElement;
    }
    return el;
  }

  function ref(el) {
    if (!el || !el.isConnected) return null;
    var path = __auditPath(el);
    return path ? { path: path, label: __auditDescribe(el) } : null;
  }

  var mutationObserver = new MutationObserver(function (records) {
    var now = performance.now();
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      if (__auditIsMaskHost(rec.target)) continue;
      if (rec.type === 'attributes' && rec.attributeName && rec.attributeName.indexOf('data-audit-') === 0) continue;
      var container = blockContainer(rec.target);
      if (!container) continue;
      var last = mutations[mutations.length - 1];
      if (last && last.el === container && now - last.time < 16) { last.time = now; continue; }
      mutations.push({ time: now, el: container });
    }
    while (mutations.length && now - mutations[0].time > KEEP_MS) mutations.shift();
  });
  mutationObserver.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });

  function regionsBefore(time) {
    var out = [];
    var seen = [];
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if (m.time > time || time - m.time > WINDOW_MS) continue;
      if (seen.indexOf(m.el) !== -1) continue;
      seen.push(m.el);
      var r = ref(m.el);
      if (r) out.push(r);
    }
    return out;
  }

  try {
    new PerformanceObserver(function (list) {
      var items = list.getEntries();
      for (var i = 0; i < items.length; i++) {
        var entry = items[i];
        if (entries.length >= MAX) return;
        var sources = [];
        var raw = entry.sources || [];
        for (var s = 0; s < raw.length && s < 8; s++) {
          var node = raw[s].node;
          var el = node && node.nodeType === 1 ? node : node && node.parentElement;
          var r = ref(el);
          if (r) sources.push(r);
        }
        entries.push({
          value: entry.value,
          hadRecentInput: !!entry.hadRecentInput,
          startTime: Math.round(entry.startTime),
          sources: sources,
          mutatedRegions: regionsBefore(entry.startTime)
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });
    supported = true;
  } catch (e) {
    supported = false;
  }

  var api = {
    read: function () { return { supported: supported, entries: entries.slice() }; },
    reset: function () { entries.length = 0; }
  };
  ${apiPublish(API)}
})();`;

/** The init script source. */
export function clsInitScript(): string {
  return PAGE_SCRIPT;
}

/** Installs the layout-shift collector in every page `context` opens from now on. */
export async function installClsCollector(context: BrowserContext): Promise<void> {
  await context.addInitScript({ content: PAGE_SCRIPT });
}

/**
 * The page's layout shifts since the last reset. A page without the collector (opened
 * before installation) reads as unsupported with no entries.
 */
export async function readShifts(page: Page): Promise<ShiftReading> {
  const reading = (await page.evaluate(apiCall(API, 'read'))) as ShiftReading | null;
  return reading ?? { supported: false, entries: [] };
}

/** Clears the page's recorded shifts; the DSL calls it as each step starts. */
export async function resetShifts(page: Page): Promise<void> {
  await page.evaluate(apiCall(API, 'reset', 'undefined'));
}

/**
 * The step's layout-shift observations (Req 30.1): one `cls` observation when the sum
 * exceeds 0.1, and one `shift-outside-region` per shift that moved something outside
 * the arriving data's region. `total` is returned for the step record either way.
 */
export function clsObservations(
  reading: ShiftReading,
  where: ObservationWhere,
): { total: number | null; observations: RawObservation[] } {
  if (!reading.supported) return { total: null, observations: [] };
  const summary = summariseShifts(reading.entries);
  const findings = [
    ...(summary.observation ? [summary.observation] : []),
    ...shiftOutsideRegionFindings(reading.entries),
  ];
  return {
    total: summary.total,
    observations: findings.map((finding) => ({ ...finding, member: where.member, url: where.url })),
  };
}
