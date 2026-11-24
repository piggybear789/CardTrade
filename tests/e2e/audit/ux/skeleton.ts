// tests/e2e/audit/ux/skeleton.ts
//
// THE SKELETON / PLACEHOLDER COLLECTOR (Req 30.3). structure.md is unambiguous: there
// are no `loading.tsx` files and no skeleton placeholders anywhere in the web app, and a
// navigation holds the CURRENT page until the target is ready. Any visible element
// matching `SKELETON_SELECTORS` (`.animate-pulse`, `[class*=skeleton]`,
// `[class*=shimmer]`, `[data-skeleton]`), or `[aria-busy="true"]` with no text that
// draws shapes (a filled background, an image or an svg on or inside it), is an
// observation. A busy region that is simply blank is the "hold, do not draw" rule.
//
// A placeholder is usually on screen for a few hundred milliseconds, between a click and
// the data, so looking only at the end of a step would miss exactly the case the rule is
// about. The init script therefore re-scans on every DOM mutation (once per animation
// frame) and remembers what it SAW during the step; the reading reports both that and
// what is visible now.
//
// A busy control that still has text ("Saving…") is not a placeholder, and neither is a
// spinner (`animate-spin`): neither matches.

import type { BrowserContext, Page } from '@playwright/test';

import { BUSY_PLACEHOLDER_SELECTOR, SKELETON_SELECTORS } from '../core/overflow';
import type { RawObservation } from '../core/uxPolicy';
import { DOM_HELPERS, apiCall, apiGuard, apiPublish, type ObservationWhere } from './pageSnippets';

const API = '__nodittoAuditSkeleton';

/** Distinct placeholders remembered per document. */
const MAX_SEEN = 50;

/** One placeholder the page showed. */
export interface PlaceholderHit {
  /** `tag#id.class…` of the element. */
  selector: string;
  /** Which rule matched: a `SKELETON_SELECTORS` entry, or the busy selector. */
  matched: string;
  /** True when it is still visible at read time. */
  visibleNow: boolean;
}

/** What `readPlaceholders` returns for one page. */
export interface PlaceholderReading {
  hits: PlaceholderHit[];
}

const PAGE_SCRIPT = String.raw`
(function () {
  if (window.top !== window) return;
  ${apiGuard(API)}
  ${DOM_HELPERS}
  var SELECTORS = ${JSON.stringify(SKELETON_SELECTORS)};
  var BUSY = ${JSON.stringify(BUSY_PLACEHOLDER_SELECTOR)};
  var MAX = ${MAX_SEEN};
  var seen = {};
  var order = [];
  var scheduled = false;

  function visible(el) {
    if (!el.isConnected) return false;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // A busy region that paints NOTHING is not a placeholder. The contract chat's log is
  // aria-busy and deliberately blank until its history loads (ContractChat.tsx, "NOTHING
  // UNTIL THE HISTORY HAS LOADED"), which is exactly the "hold, do not draw" rule. A
  // placeholder draws shapes: a filled background, a background image, an image or an
  // svg, on the busy element or on something visible inside it.
  function paints(el) {
    var tag = el.tagName;
    if (tag === 'IMG' || tag === 'svg' || tag === 'SVG' || tag === 'CANVAS') return true;
    var cs = getComputedStyle(el);
    var bg = cs.backgroundColor;
    if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg)) return true;
    return cs.backgroundImage && cs.backgroundImage !== 'none';
  }
  function drawsShapes(el) {
    // A busy CONTROL (a pending button, an icon button showing its spinner) is not a
    // placeholder for content, and neither is a spinner.
    var tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'FORM') return false;
    // Stripe.js draws its own loading shimmer (__PrivateStripeElementLoader) inside
    // the mount point while an Element's iframe boots. It is Stripe's markup, not the
    // app's, and the app cannot hold the page for a third-party frame.
    if (el.closest('[class*="__PrivateStripe"]')) return false;
    if (el.matches('.animate-spin') || el.querySelector('.animate-spin')) return false;
    if (paints(el)) return true;
    var inner = el.querySelectorAll('*');
    for (var j = 0; j < inner.length && j < 200; j++) {
      if (visible(inner[j]) && paints(inner[j])) return true;
    }
    return false;
  }

  function scan() {
    var now = [];
    if (!document.body) return now;
    for (var s = 0; s < SELECTORS.length + 1; s++) {
      var selector = s < SELECTORS.length ? SELECTORS[s] : BUSY;
      var list;
      try { list = document.body.querySelectorAll(selector); } catch (e) { continue; }
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (__auditIsMaskHost(el)) continue;
        if (selector === BUSY && (el.textContent || '').trim() !== '') continue;
        if (selector === BUSY && !drawsShapes(el)) continue;
        if (!visible(el)) continue;
        var key = __auditDescribe(el) + '|' + selector;
        now.push(key);
        if (!seen[key] && order.length < MAX) {
          seen[key] = { selector: __auditDescribe(el), matched: selector };
          order.push(key);
        }
      }
    }
    return now;
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () { scheduled = false; scan(); });
  }

  new MutationObserver(schedule).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-busy', 'data-skeleton', 'style', 'hidden'] });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule);
  schedule();

  var api = {
    read: function () {
      var now = scan();
      return {
        hits: order.map(function (key) {
          return { selector: seen[key].selector, matched: seen[key].matched, visibleNow: now.indexOf(key) !== -1 };
        })
      };
    },
    reset: function () {
      seen = {};
      order = [];
    }
  };
  ${apiPublish(API)}
})();`;

/** The init script source. */
export function skeletonInitScript(): string {
  return PAGE_SCRIPT;
}

/** Installs the placeholder collector in every page `context` opens from now on. */
export async function installSkeletonCollector(context: BrowserContext): Promise<void> {
  await context.addInitScript({ content: PAGE_SCRIPT });
}

/** Placeholders seen since the last reset, and whether each is still visible. */
export async function readPlaceholders(page: Page): Promise<PlaceholderReading> {
  const reading = (await page.evaluate(apiCall(API, 'read'))) as PlaceholderReading | null;
  return reading ?? { hits: [] };
}

/** Forgets the placeholders seen so far; the DSL calls it as each step starts. */
export async function resetPlaceholders(page: Page): Promise<void> {
  await page.evaluate(apiCall(API, 'reset', 'undefined'));
}

/**
 * One `skeleton` observation per page that showed a placeholder during the step
 * (Req 30.3), naming up to five of them. Blocking by default (`uxPolicy.ts`).
 */
export function skeletonObservations(reading: PlaceholderReading, where: ObservationWhere): RawObservation[] {
  if (reading.hits.length === 0) return [];
  const named = reading.hits.slice(0, 5).map((hit) => `${hit.selector} (${hit.matched}${hit.visibleNow ? '' : ', gone by the end of the step'})`);
  return [
    {
      check: 'skeleton',
      member: where.member,
      url: where.url,
      message:
        `Placeholder shown: ${named.join(', ')}${reading.hits.length > 5 ? `, and ${reading.hits.length - 5} more` : ''}. ` +
        'The app has no skeletons; a navigation holds the current page until the target is ready.',
      detail: {
        count: reading.hits.length,
        visibleNow: reading.hits.filter((hit) => hit.visibleNow).length,
        selectors: reading.hits.map((hit) => hit.selector).join(' | '),
      },
    },
  ];
}
