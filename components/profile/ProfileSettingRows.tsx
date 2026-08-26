'use client';

// components/profile/ProfileSettingRows.tsx
//
// The Profile tab's editable settings, as list rows that report their current value
// and open an editor when tapped.
//
// WHY THESE EXIST. Bio and Links were rendered as live editors sitting open on the
// page: a textarea holding placeholder prose above a `0/280` counter, and a dashed
// "None yet." box with its own Add control. Settings is read far more often than it
// is changed, so the resting state should say what IS set — the editors are the
// exception, not the default view.
//
// `Dialog` rather than `Sheet`: its default `mobile="sheet"` presentation is already
// a bottom sheet on phones with safe-area and software-keyboard insets handled, and
// a centred dialog from `md` up. One component, correct at both ends.

import { useState } from 'react';

import { SettingsListRow } from '@/components/account/SettingsPrimitives';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ProfileBioEditor } from './ProfileBioEditor';
import { SocialLinksEditor } from './SocialLinksEditor';

export function BioSettingRow({ bio }: { bio: string }) {
  const [open, setOpen] = useState(false);
  const trimmed = bio.trim();

  return (
    <>
      <SettingsListRow
        label="Bio"
        // The bio goes in `description`, not `value`: the value slot is capped at
        // 45% of the row so a right-aligned setting cannot crowd its own label, which
        // for prose meant a useless nineteen-character preview. As a description it
        // gets the full width on its own line.
        description={trimmed || undefined}
        value={trimmed ? undefined : 'Not set'}
        onClick={() => setOpen(true)}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bio</DialogTitle>
            <DialogDescription>
              Shown on your public profile. Tell other collectors what you trade and
              how you post.
            </DialogDescription>
          </DialogHeader>
          {/* Keyed so reopening after a save starts from the saved text rather than
              the value this component mounted with. */}
          <ProfileBioEditor key={bio} initialBio={bio} onSaved={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function LinksSettingRow({
  links,
}: {
  links: Record<string, string> | null;
}) {
  const [open, setOpen] = useState(false);
  const count = links ? Object.values(links).filter((value) => value).length : 0;

  return (
    <>
      <SettingsListRow
        label="Links"
        value={count === 0 ? 'None' : count === 1 ? '1 link' : `${count} links`}
        onClick={() => setOpen(true)}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Links</DialogTitle>
            <DialogDescription>
              Usernames for socials; a full https link for your store.
            </DialogDescription>
          </DialogHeader>
          <SocialLinksEditor initialLinks={links} onSaved={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
