// tests/e2e/audit/copy.ts
//
// THE COPY CHECKER: the Playwright half of `core/copyRules.ts`. After each step it reads
// the VISIBLE text of every app-origin page the step touched (`document.body.innerText`,
// which skips `display: none`, applies `text-transform`, and cannot see the Masker's
// closed shadow root) and hands it to the pure rules:
//
//   every step            checkForbiddenTerms (Req 31.4), checkCurrencyCodes (Req 31.5)
//   copy.shopfront        checkShopfrontCopy  (Req 31.1)
//   copy.collateral       checkCollateralCopy (Req 31.2)
//   copy.fee              checkFeeLabel       (Req 31.3), against the label computed here
//
// The expected fee label is `processingFeeRateLabel(currency, method)` from
// `lib/fees/feeLabels.ts`, which reads `domain/fees/processingFee.ts`: the same function
// the app renders the label with, so the check compares the page with the charge table
// rather than with a second copy of it. `copyRules.ts` takes the label as an argument so
// that it stays pure.
//
// Severity is `uxPolicy.ts`'s. `copy-currency` depends on where the figure was shown,
// which is the step's `moneySurface` in the classification context, not this module's.

import type { Page } from '@playwright/test';

import { processingFeeRateLabel } from '../../../lib/fees/feeLabels';
import type { PaymentMethodKind } from '../../../domain/payments/paymentMethods';
import {
  checkCollateralCopy,
  checkCurrencyCodes,
  checkFeeLabel,
  checkForbiddenTerms,
  checkShopfrontCopy,
  type CopyObservation,
} from './core/copyRules';
import type { RawObservation } from './core/uxPolicy';
import type { ObservationWhere } from './ux/pageSnippets';

/** A step's declared copy checks (design: `step(..., { copy })`). */
export interface StepCopyDeclaration {
  /** The step shows a Multiple items listing or contract. */
  shopfront?: boolean;
  /** The step shows trade collateral. */
  collateral?: boolean;
  /** The step shows the buyer protection fee for this currency and way of paying (card by default). */
  fee?: { currency: string; method?: PaymentMethodKind };
}

/** The buyer protection fee label the page must show for `fee` (Req 31.3). */
export function expectedFeeLabel(fee: NonNullable<StepCopyDeclaration['fee']>): string {
  return processingFeeRateLabel(fee.currency, fee.method ?? 'CARD');
}

/**
 * Runs the copy rules over `text` (Req 31.1–31.5): the forbidden-term and currency-code
 * rules always, the others when the step declares them. Pure apart from computing the
 * fee label.
 */
export function copyFindings(text: string, copy: StepCopyDeclaration = {}): CopyObservation[] {
  const findings: CopyObservation[] = [...checkForbiddenTerms(text), ...checkCurrencyCodes(text)];
  if (copy.shopfront) findings.push(...checkShopfrontCopy(text));
  if (copy.collateral) findings.push(...checkCollateralCopy(text));
  if (copy.fee) findings.push(...checkFeeLabel(text, expectedFeeLabel(copy.fee)));
  return findings;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The page's visible text, or null when the page is not on `appOrigin` (Stripe's hosted
 * pages are recorded on video but never judged).
 */
export async function readVisibleText(page: Page, appOrigin: string): Promise<string | null> {
  const expected = originOf(appOrigin);
  if (expected === null) throw new Error(`readVisibleText: appOrigin is not an absolute URL: ${appOrigin}`);
  if (originOf(page.url()) !== expected) return null;
  // A string expression, for the reason `ux/pageSnippets.ts` gives.
  return (await page.evaluate('document.body ? document.body.innerText : ""')) as string;
}

/**
 * Reads `page` and returns its copy observations, or an empty array for a page that is
 * not on the app origin. `where.url` must already be scrubbed; the messages carry page
 * excerpts and are scrubbed by the caller like every other observation.
 */
export async function checkPageCopy(
  page: Page,
  options: { appOrigin: string; where: ObservationWhere; copy?: StepCopyDeclaration },
): Promise<RawObservation[]> {
  const text = await readVisibleText(page, options.appOrigin);
  if (text === null) return [];
  return copyFindings(text, options.copy).map((finding) => ({
    ...finding,
    member: options.where.member,
    url: options.where.url,
  }));
}
