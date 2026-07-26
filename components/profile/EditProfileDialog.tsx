'use client';

// components/profile/EditProfileDialog.tsx
//
// The Profile card as a summary plus a modal editor. Account settings are read
// far more often than they are changed, so the page shows what is set and keeps
// the inputs behind a deliberate action.

import { useState } from 'react';
import { Pencil } from 'lucide-react';

import { ProfileForm } from './ProfileForm';
import { Button } from '@/components/ui/button';
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
}: {
  displayName: string;
  contactEmail: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Pencil aria-hidden />
          Edit details
        </Button>
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
          embedded
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
