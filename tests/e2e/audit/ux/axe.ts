// tests/e2e/audit/ux/axe.ts
//
// THE ACCESSIBILITY COLLECTOR (Req 30.5): `@axe-core/playwright` with the WCAG 2.1 A and
// AA rule tags, run at the end of a step on app-origin pages only. Classification is
// `uxPolicy.ts`'s: critical and serious violations are blocking, moderate and minor
// advisory, and a violation with no stated impact is blocking.
//
// APP ORIGIN ONLY. A page whose URL is not the App_Server's is not analysed at all, and
// inside an app page every iframe from another origin (Stripe's Payment Element, the
// Google Maps embed) is excluded, so a third party's markup never fails a Pathway. The
// iframes are marked with `data-audit-axe-skip` for the duration of the run, because axe
// excludes by selector and an iframe's `src` is not a selector it can be trusted to
// escape; the marks are removed afterwards. The Masker's overlay host is excluded too: it
// is `aria-hidden` test furniture, not the app.
//
// One observation per violated rule, naming how many nodes fail it and the first few
// targets. `axe` reports node HTML as well; it is deliberately not copied, because it can
// carry an email or a name the Masker hides on screen.

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import type { RawObservation } from '../core/uxPolicy';
import { MASK_HOST_TAG, type ObservationWhere } from './pageSnippets';

/** The axe rule tags for WCAG 2.1 A and AA. */
export const WCAG_TAGS: readonly string[] = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** The attribute that marks a cross-origin iframe for exclusion during one run. */
export const AXE_SKIP_ATTRIBUTE = 'data-audit-axe-skip';

/** How many failing targets an observation names. */
const MAX_TARGETS = 3;

/** One violated rule, as the collector keeps it. */
export interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  nodes: number;
  /** CSS selectors of the first failing nodes. */
  targets: string[];
}

/** What `runAxe` returns for one page. */
export interface AxeReading {
  /** False when the page was not on the app origin, so nothing was analysed. */
  analysed: boolean;
  violations: AxeViolation[];
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// Strings, for the reason `pageSnippets.ts` gives.
const MARK_FOREIGN_FRAMES = String.raw`
(function (attribute) {
  var frames = document.querySelectorAll('iframe, frame');
  var marked = 0;
  for (var i = 0; i < frames.length; i++) {
    var src = frames[i].getAttribute('src') || '';
    if (src === '' || src === 'about:blank' || src.indexOf('javascript:') === 0) continue;
    var origin;
    try { origin = new URL(src, location.href).origin; } catch (e) { origin = null; }
    if (origin !== location.origin) { frames[i].setAttribute(attribute, ''); marked++; }
  }
  return marked;
})`;

const UNMARK_FOREIGN_FRAMES = String.raw`
(function (attribute) {
  var marked = document.querySelectorAll('[' + attribute + ']');
  for (var i = 0; i < marked.length; i++) marked[i].removeAttribute(attribute);
})`;

/**
 * Runs axe's WCAG 2.1 A/AA rules on `page` when it is on `appOrigin` (Req 30.5).
 * Cross-origin iframes and the Masker's overlay are excluded.
 */
export async function runAxe(page: Page, appOrigin: string): Promise<AxeReading> {
  const expected = originOf(appOrigin);
  if (expected === null) throw new Error(`runAxe: appOrigin is not an absolute URL: ${appOrigin}`);
  if (originOf(page.url()) !== expected) return { analysed: false, violations: [] };

  const attribute = JSON.stringify(AXE_SKIP_ATTRIBUTE);
  const foreign = (await page.evaluate(`${MARK_FOREIGN_FRAMES}(${attribute})`)) as number;
  try {
    // Legacy mode runs `axe.run()` in the page itself. The default mode finishes every
    // run in a blank page it opens in the member's context, which became a recorded
    // page: one empty `video.<member>.<n>.webm` per page per step. Legacy mode does not
    // test cross-origin frames, which are excluded here anyway.
    let builder = new AxeBuilder({ page }).setLegacyMode(true).withTags([...WCAG_TAGS]).exclude(MASK_HOST_TAG);
    if (foreign > 0) builder = builder.exclude(`[${AXE_SKIP_ATTRIBUTE}]`);
    // While a modal dialog, sheet or popover is open, Radix (the `aria-hidden` package)
    // marks everything behind it `data-aria-hidden="true"`: inert to assistive tech and
    // dimmed under the scrim. axe measured that dimmed text's contrast through the
    // scrim and reported it. The same content is checked unobscured on the steps where
    // nothing is open, so only the hidden-behind-a-modal copy is skipped.
    const behindModal = (await page.evaluate('document.querySelectorAll(\'[data-aria-hidden="true"]\').length')) as number;
    if (behindModal > 0) builder = builder.exclude('[data-aria-hidden="true"]');
    const results = await builder.analyze();
    return {
      analysed: true,
      violations: results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact ?? null,
        help: violation.help,
        helpUrl: violation.helpUrl,
        nodes: violation.nodes.length,
        targets: violation.nodes.slice(0, MAX_TARGETS).map((node) => node.target.map(String).join(' >>> ')),
      })),
    };
  } finally {
    if (!page.isClosed()) {
      await page.evaluate(`${UNMARK_FOREIGN_FRAMES}(${attribute})`).catch(() => undefined);
    }
  }
}

/** One `a11y` observation per violated rule, with axe's impact in `detail.impact`. */
export function axeObservations(reading: AxeReading, where: ObservationWhere): RawObservation[] {
  return reading.violations.map((violation) => ({
    check: 'a11y' as const,
    member: where.member,
    url: where.url,
    message:
      `Accessibility (${violation.id}): ${violation.help}. ` +
      `${violation.nodes} node${violation.nodes === 1 ? '' : 's'}, e.g. ${violation.targets.join(', ') || '(no target)'}.`,
    detail: {
      rule: violation.id,
      impact: violation.impact ?? 'unknown',
      nodes: violation.nodes,
      targets: violation.targets.join(' | '),
      helpUrl: violation.helpUrl,
    },
  }));
}
