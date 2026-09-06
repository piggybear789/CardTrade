'use client';

// components/account/SettingsDialogRows.tsx
//
// The two account rows that OPEN A DIALOG, as client components that build their own
// trigger.
//
// WHY THESE EXIST RATHER THAN THE PAGE PASSING A ROW IN. `EditProfileDialog` and
// `AddPaymentMethodDialog` take a `trigger` element and clone an `onClick` onto it.
// That works only when the element was created on the same side of the RSC boundary as
// the clone. `app/(workspace)/profile/page.tsx` is a Server Component, and building the
// row there produced three separate failures in a row:
//
//   1. `onClick={() => {}}` on the server — passed to make the row render as a
//      `<button>` — is a function crossing into a Client Component. React refuses to
//      serialise it ("Event handlers cannot be passed to Client Component props") and
//      the route error boundary swallowed the WHOLE account surface: no tab strip, no
//      rows, for every member.
//   2. Replacing it with a serialisable `interactive` flag fixed the crash, but the
//      dialogs' `isValidElement(trigger)` check did not answer the same way on the SSR
//      pass as in the browser, so the server emitted their `<div>` fallback wrapper and
//      the browser emitted the cloned `<button>` — a hydration mismatch that made React
//      throw the tree away.
//   3. Routing both through `withRowOpenHandler` removed the mismatch, because it
//      returns the trigger unchanged instead of wrapping it. But "unchanged" means NO
//      HANDLER: the payment row streams inside its own Suspense boundary, the clone
//      could not identify it there, and the row rendered as a button that did nothing.
//      Silent, and invisible to any test that only asserts the page no longer crashes.
//
// Creating the trigger HERE removes the boundary from the problem entirely. Only plain
// data crosses from the page; the element and the clone are both client-side, so
// `isValidElement` is true on both passes and the handler always lands.

import { CreditCardIcon } from '@hugeicons/core-free-icons';

import { SettingsListRow } from '@/components/account/SettingsPrimitives';
import { AddPaymentMethodDialog } from '@/components/payments/AddPaymentMethodDialog';
import { EditProfileDialog } from '@/components/profile/EditProfileDialog';

/** The name-and-email row, which is also the edit trigger. */
export function NameAndEmailSettingRow({
  displayName,
  contactEmail,
  avatarPath = null,
}: {
  displayName: string;
  contactEmail: string;
  avatarPath?: string | null;
}) {
  return (
    <EditProfileDialog
      displayName={displayName}
      contactEmail={contactEmail}
      avatarPath={avatarPath}
      trigger={<SettingsListRow label="Name and email" value={contactEmail} />}
    />
  );
}

/**
 * The saved-card row, which opens the add/replace dialog.
 *
 * Takes the resolved status as data rather than reading it: the live Stripe call stays
 * in the page's server component, behind its own Suspense boundary.
 */
export function PaymentMethodSettingRow({
  hasCard,
  label,
}: {
  hasCard: boolean;
  label: string | null;
}) {
  return (
    <AddPaymentMethodDialog
      trigger={
        <SettingsListRow
          icon={CreditCardIcon}
          label="Payment method"
          // ONE LINE. The card used to be the value beside a two-line label carrying
          // the expiry, so it floated against the middle of a block it was supposed to
          // be reading out. The expiry belongs in the editor, not in a list whose job
          // is "what is set".
          value={hasCard ? (label ?? 'Card saved') : 'Add a card'}
          description={hasCard ? undefined : 'Required to buy or back a trade.'}
        />
      }
    />
  );
}
