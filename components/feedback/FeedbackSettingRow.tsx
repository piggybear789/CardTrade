'use client';

// components/feedback/FeedbackSettingRow.tsx
//
// The Account tab's entry into {@link FeedbackDialog}.
//
// WHY IT EXISTS AS ITS OWN CLIENT COMPONENT. `app/(workspace)/profile/page.tsx` is a
// Server Component, and a dialog trigger built there does not survive the boundary:
// Radix clones handlers onto the element with `asChild`, and an element created on the
// server answers `isValidElement` differently during SSR than in the browser. The
// resulting hydration mismatch makes React throw the subtree away and the row becomes a
// control that opens nothing. `components/account/SettingsDialogRows.tsx` records all
// three ways this has failed. Building the row here — client-side, next to the clone —
// removes the boundary from the problem.
//
// WHY THE ACCOUNT TAB AT ALL, given the header already has a feedback icon: that icon
// lives in the dark desktop bar, which is `md` and up, and the burger that carries the
// menu row is also `md` and up for a signed-in member. Without this row a member on a
// phone — most of them — has no way to reach the dialog.

import { ChatFeedbackIcon } from '@hugeicons/core-free-icons';

import { SettingsListRow } from '@/components/account/SettingsPrimitives';
import { FeedbackDialog } from '@/components/feedback/FeedbackDialog';

/** The "Send feedback" row on Account → Profile. */
export function FeedbackSettingRow() {
  return (
    <FeedbackDialog
      trigger={
        <SettingsListRow
          icon={ChatFeedbackIcon}
          label="Send feedback"
          description="Report a problem or suggest a feature."
        />
      }
    />
  );
}
