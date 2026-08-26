'use client';

// components/profile/EditProfileDialog.tsx
//
// The Profile card as a summary plus a modal editor. Account settings are read
// far more often than they are changed, so the page shows what is set and keeps
// the inputs behind a deliberate action.

import { useState, type ReactNode } from 'react';
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
  trigger,
}: {
  displayName: string;
  contactEmail: string;
  /** Current avatar object path, or null. */
  avatarPath?: string | null;
  /**
   * What opens the dialog. The Settings tab passes a list row so name and email are
   * edited from the same row vocabulary as everything else; the default standalone
   * pencil remains for any surface that is not a settings list.
   */
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-body font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline border border-transparent focus:outline-none focus-visible:border-gold/40"
          >
            <Pencil className="size-3" aria-hidden />
            Edit
          </button>
        )}
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
