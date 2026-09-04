'use client';

// components/profile/ProfileForm.tsx
//
// The display-name + contact-email editor, wired to the `updateProfile` Server
// Action. Field-level validation errors render inline against the offending input
// (Req 1.5) and a successful save confirms with a toast (Req 1.4). Only the owner
// reaches this form — the page reads the caller's own row and RLS confines the
// write to `auth.uid() = id` (Req 1.6).
//
// DIALOG-ONLY. This previously carried a SECOND copy of both fields wrapped in
// Card chrome, for a non-embedded page rendering that no longer existed — the only
// caller is `EditProfileDialog`, which always passed `embedded`. Two copies of one
// form is how the two drift: the embedded branch had gained the avatar field and
// the Card branch never did. The dead branch and the `embedded` prop are gone.
//
// Styling follows the account settings surface: eyebrow-cased labels and the
// compact avatar picker, so opening the editor does not look like a different app
// from the page behind it.

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { LoaderCircleIcon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import { updateProfile } from '@/lib/actions/profile';
import { AvatarUploadField } from '@/components/profile/AvatarUploadField';
import { Button } from '@/components/ui/button';
import { DialogClose, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface ProfileFormProps {
  /** The Profile's current display name. */
  initialDisplayName: string;
  /** The Profile's current contact email. */
  initialContactEmail: string;
  /** Current avatar object path, or null when the member has none. */
  initialAvatarPath?: string | null;
  /** Called after a successful save, e.g. to close the dialog. */
  onSaved?: () => void;
}

/**
 * Eyebrow-cased field label.
 *
 * A real `<Label htmlFor>`, NOT the `<p>`-based `SectionLabel` used on the
 * settings page: these labels sit above actual inputs, so dropping the
 * association to gain the same styling would leave each input unnamed for a
 * screen reader. The `market-label` class supplies the casing and tracking.
 */
function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <Label htmlFor={htmlFor} className="market-label text-muted-foreground">
      {children}
    </Label>
  );
}

export function ProfileForm({
  initialDisplayName,
  initialContactEmail,
  initialAvatarPath = null,
  onSaved,
}: ProfileFormProps) {
  const [displayName, setDisplayName] = React.useState(initialDisplayName);
  const [contactEmail, setContactEmail] = React.useState(initialContactEmail);
  // Avatar state is separate from the form's: it persists on pick, so it is not
  // part of what submit sends.
  const [avatarPath, setAvatarPath] = React.useState<string | null>(initialAvatarPath);
  const [fieldError, setFieldError] = React.useState<{
    field?: string;
    message: string;
  } | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const router = useRouter();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldError(null);
    setIsSaving(true);

    try {
      const result = await updateProfile({ displayName, contactEmail });

      if (result.ok) {
        // Sync local state with the persisted values and confirm (Req 1.4).
        setDisplayName(result.data.displayName);
        setContactEmail(result.data.contactEmail);
        router.refresh();
        onSaved?.();
        return;
      }

      // On failure, surface the message; associate it with a field when known so
      // prior values remain visible and the error is actionable (Req 1.5).
      setFieldError({ field: result.field, message: result.message });
      if (!result.field) {
        toast.error(result.message);
      }
    } catch {
      const message = 'Something went wrong. Please try again.';
      setFieldError({ message });
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  }

  const displayNameError =
    fieldError?.field === 'displayName' ? fieldError.message : undefined;
  const contactEmailError =
    fieldError?.field === 'contactEmail' ? fieldError.message : undefined;
  const generalError = fieldError && !fieldError.field ? fieldError.message : undefined;

  return (
    // The form is the dialog's only child, so DialogContent's flex gap cannot
    // reach the fields and the footer. Repeating it here spaces them the way
    // every other dialog does.
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3 sm:gap-4">
      <div className="space-y-tight">
        <FieldLabel htmlFor="displayName">Display name</FieldLabel>
        <Input
          id="displayName"
          name="displayName"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          maxLength={255}
          autoComplete="name"
          aria-invalid={displayNameError ? true : undefined}
          aria-describedby={displayNameError ? 'displayName-error' : undefined}
          disabled={isSaving}
        />
        {displayNameError ? (
          <p id="displayName-error" role="alert" className="text-body text-destructive">
            {displayNameError}
          </p>
        ) : null}
      </div>

      <div className="space-y-tight">
        <FieldLabel htmlFor="contactEmail">Contact email</FieldLabel>
        <Input
          id="contactEmail"
          name="contactEmail"
          type="email"
          value={contactEmail}
          onChange={(event) => setContactEmail(event.target.value)}
          maxLength={255}
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={contactEmailError ? true : undefined}
          aria-describedby={contactEmailError ? 'contactEmail-error' : undefined}
          disabled={isSaving}
        />
        {contactEmailError ? (
          <p id="contactEmail-error" role="alert" className="text-body text-destructive">
            {contactEmailError}
          </p>
        ) : null}
      </div>

      {/* AFTER the two fields, not above them. The picture is optional and saves
          on pick — independently of this form's submit, see AvatarUploadField —
          so leading with it gave the one thing that is not part of "Save changes"
          the most prominent position, above the name people opened this to edit.

          A styled <p>, NOT a <Label>: the control is a button, and a <label> with
          no labelable form control associates with nothing. The group takes its
          accessible name from this text; the button carries its own aria-label. */}
      <div
        role="group"
        aria-labelledby="avatar-field-label"
        className="flex items-center gap-group border-t pt-cozy"
      >
        <AvatarUploadField
          avatarPath={avatarPath}
          displayName={displayName}
          onChange={setAvatarPath}
          disabled={isSaving}
          hideHint
          compact
        />
        <div className="min-w-0 flex-1 space-y-tight">
          <p id="avatar-field-label" className="text-body font-medium leading-none">
            Profile picture{' '}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </p>
          <p className="text-body leading-relaxed text-muted-foreground">
            PNG, JPEG or WebP, up to 2 MB. Saves as soon as you pick it.
          </p>
        </div>
      </div>

      {generalError ? (
        <p role="alert" className="text-body text-destructive">
          {generalError}
        </p>
      ) : null}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="ghost" disabled={isSaving}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={isSaving} aria-busy={isSaving}>
          {isSaving ? <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden /> : null}
          {isSaving ? 'Saving…' : 'Save changes'}
        </Button>
      </DialogFooter>
    </form>
  );
}
