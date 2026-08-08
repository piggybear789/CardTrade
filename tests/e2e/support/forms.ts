// tests/e2e/support/forms.ts
//
// Filling a CONTROLLED input reliably.
//
// THE PROBLEM. Most forms here hold their fields in `React.useState`, so an input's
// value is owned by React, not the DOM. `fill()` writes the DOM value and dispatches
// an `input` event; if React has not hydrated and attached its listener yet, nothing
// records the change, and the first render after hydration overwrites the field with
// the state value — which is empty. The field ends up blank with no error of any kind.
//
// It surfaces far from its cause: a submit button that never enables, or a server
// action rejecting a field the test can plainly see it filled. It is intermittent on
// desktop and frequent on the mobile project, where hydration takes longer.
//
// WHY THIS IS NOT PURELY A TEST CONCERN. A person on a slow phone can type into a form
// before it hydrates and lose what they typed, silently. `components/auth/AuthForm.tsx`
// already carries a hydration guard for exactly this reason. Closing it everywhere is a
// wider change than a test helper, so it is recorded as a finding; this helper stops
// the suite from reporting it as a dozen unrelated failures in the meantime.
//
// WHY VERIFY RATHER THAN WAIT FOR HYDRATION. There is no reliable, app-agnostic signal
// for "React has attached to this field". Asserting the value landed IS the signal, and
// it fails loudly and specifically when it has not.

import { expect, type Locator } from '@playwright/test';

/**
 * Fill a field and confirm the value actually stuck, retrying once.
 *
 * The retry is what handles the hydration race: the second attempt runs after React
 * has attached, so it registers. A second failure is a real problem and is left to
 * fail, naming the field.
 */
export async function fillAndConfirm(
  field: Locator,
  value: string,
  { timeout = 5_000 }: { timeout?: number } = {},
): Promise<void> {
  await field.waitFor({ state: 'visible', timeout: 15_000 });
  await field.fill(value);

  try {
    await expect(field).toHaveValue(value, { timeout });
    return;
  } catch {
    // Swallowed on purpose: one retry, then a real assertion that reports properly.
  }

  await field.fill(value);
  await expect(
    field,
    'field did not keep its value after two attempts — the form may not be hydrated, ' +
      'or something is resetting it',
  ).toHaveValue(value, { timeout: 15_000 });
}
