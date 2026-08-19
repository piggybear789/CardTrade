'use client';

// components/profile/EditProfileDialog.tsx
//
// The Profile card as a summary plus a modal editor. Account settings are read
// far more often than they are changed, so the page shows what is set and keeps
// the inputs behind a deliberate action.

import { useState } from 'react';
import { Pencil } from 'lucide-react';

import { ProfileForm } from './ProfileForm';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export function EditProfileDialog({
  displayName,
  contactEmail,
  avatarPath = null,
}: {
  displayName: string;
  contactEmail: string;
  /** Current avatar object path, or null. */
  avatarPath?: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-body font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Pencil className="size-3" aria-hidden />
          Edit
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit your details</DialogTitle>
          <DialogDescription>
            Your display name is what other traders see.
          </DialogDescription>
        </DialogHeader>
        <ProfileForm
          initialDisplayName={displayName}
          initialContactEmail={contactEmail}
          initialAvatarPath={avatarPath}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
