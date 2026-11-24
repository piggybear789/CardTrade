// tests/e2e/audit/ux/overflow.ts
//
// THE HORIZONTAL OVERFLOW COLLECTOR: the in-page half of `core/overflow.ts`, lifted from
// `debug/horizontal-overflow.probe.spec.ts`. Read at the end of each step, so it needs
// no init script: it measures `document.documentElement.scrollWidth` against
// `window.innerWidth` and, only when the document is too wide, walks the tree for the
// boxes crossing the right edge with the first ancestor that clipped each (or null).
//
// The walk is skipped on a page that fits, because it reads layout for every element
// and a step that passes should not pay for it.
//
// Requirements:
//   30.2  the document wider than the viewport is a UX_Observation

import type { Page } from '@playwright/test';

import {
  OVERFLOW_TOLERANCE_PX,
  overflowFindings,
  type OverflowReading,
} from '../core/overflow';
import type { RawObservation } from '../core/uxPolicy';
import { DOM_HELPERS, type ObservationWhere } from './pageSnippets';

/** How many offenders the page returns at most, widest first. */
const MAX_COLLECTED = 25;

// A string, for the reason `pageSnippets.ts` gives.
const READ_SCRIPT = String.raw`
(function () {
  ${DOM_HELPERS}
  var tolerance = ${OVERFLOW_TOLERANCE_PX};
  var root = document.documentElement;
  var scrollWidth = root ? root.scrollWidth : 0;
  var innerWidth = window.innerWidth;
  var reading = { scrollWidth: scrollWidth, innerWidth: innerWidth, offenders: [] };
  if (!root || scrollWidth - innerWidth <= tolerance) return reading;
  var all = document.querySelectorAll('body *');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (__auditIsMaskHost(el)) continue;
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (rect.right + window.scrollX <= innerWidth + tolerance) continue;
    var clippedBy = null;
    for (var parent = el.parentElement; parent && parent !== root; parent = parent.parentElement) {
      var overflowX = getComputedStyle(parent).overflowX;
      if (overflowX !== 'visible') {
        clippedBy = __auditDescribe(parent) + ' [overflow-x:' + overflowX + ']';
        break;
      }
    }
    reading.offenders.push({
      selector: __auditDescribe(el),
      right: Math.round(rect.right + window.scrollX),
      width: Math.round(rect.width),
      clippedBy: clippedBy
    });
  }
  reading.offenders.sort(function (a, b) { return b.right - a.right; });
  reading.offenders = reading.offenders.slice(0, ${MAX_COLLECTED});
  return reading;
})()`;

/** Reads the page's width and, when it overflows, the boxes crossing the right edge. */
export async function readOverflow(page: Page): Promise<OverflowReading> {
  return (await page.evaluate(READ_SCRIPT)) as OverflowReading;
}

/** The step's overflow observation, if any (Req 30.2). */
export function overflowObservations(reading: OverflowReading, where: ObservationWhere): RawObservation[] {
  return overflowFindings(reading).map((finding) => ({ ...finding, member: where.member, url: where.url }));
}
