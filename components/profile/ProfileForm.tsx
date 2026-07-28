"use client";

// components/profile/ProfileForm.tsx
//
// Client form for viewing/editing the owner's Profile (display name + contact
// email), wired to the `updateProfile` Server Action. It surfaces field-level
// validation errors inline against the offending input (Req 1.5) and confirms a
// successful save with a sonner toast (Req 1.4). Only the owner ever reaches
// this form — the page reads the caller's own row and RLS confines the write to
// `auth.uid() = id` (Req 1.6).

import * as React from "react";
import { toast } from "sonner";

import { updateProfile } from "@/lib/actions/profile";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ProfileFormProps {
  /** The Profile's current display name. */
  initialDisplayName: string;
  /** The Profile's current contact email. */
  initialContactEmail: string;
  /**
   * Render only the fields and submit control, without the surrounding Card, so
   * the form can live inside a dialog.
   */
  embedded?: boolean;
  /** Called after a successful save, e.g. to close the dialog. */
  onSaved?: () => void;
}

/**
 * Editable Profile form. Local state holds the current field values; on submit
 * it calls {@link updateProfile}. A `VALIDATION` failure reports a `field`,
 * which we render inline and associate with the input via `aria-describedby`
 * (Req 1.5). Success shows a confirmation toast (Req 1.4).
 */
export function ProfileForm({
  initialDisplayName,
  initialContactEmail,
  embedded = false,
  onSaved,
}: ProfileFormProps) {
  const [displayName, setDisplayName] = React.useState(initialDisplayName);
  const [contactEmail, setContactEmail] = React.useState(initialContactEmail);
  const [fieldError, setFieldError] = React.useState<{
    field?: string;
    message: string;
  } | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);

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
        toast.success("Profile updated");
        onSaved?.();
        return;
      }

      // On failure, surface the message; associate it with a field when known
      // so prior values remain visible and the error is actionable (Req 1.5).
      setFieldError({ field: result.field, message: result.message });
      if (!result.field) {
        toast.error(result.message);
      }
    } catch {
      const message = "Something went wrong. Please try again.";
      setFieldError({ message });
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  }

  const displayNameError =
    fieldError?.field === "displayName" ? fieldError.message : undefined;
  const contactEmailError =
    fieldError?.field === "contactEmail" ? fieldError.message : undefined;
  const generalError =
    fieldError && !fieldError.field ? fieldError.message : undefined;

  const fields = (
    <>
      <div className="space-y-2">
        <Label htmlFor="displayName">Display name</Label>
        <Input
          id="displayName"
          name="displayName"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={255}
          autoComplete="name"
          aria-invalid={displayNameError ? true : undefined}
          aria-describedby={displayNameError ? "displayName-error" : undefined}
          disabled={isSaving}
        />
        {displayNameError ? (
          <p id="displayName-error" role="alert" className="text-sm text-destructive">
            {displayNameError}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="contactEmail">Contact email</Label>
        <Input
          id="contactEmail"
          name="contactEmail"
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          maxLength={255}
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={contactEmailError ? true : undefined}
          aria-describedby={contactEmailError ? "contactEmail-error" : undefined}
          disabled={isSaving}
        />
        {contactEmailError ? (
          <p id="contactEmail-error" role="alert" className="text-sm text-destructive">
            {contactEmailError}
          </p>
        ) : null}
      </div>

      {generalError ? (
        <p role="alert" className="text-sm text-destructive">
          {generalError}
        </p>
      ) : null}
    </>
  );

  // Inside a dialog the Card chrome would be a second frame around the form.
  if (embedded) {
    return (
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {fields}
        <Button type="submit" disabled={isSaving} aria-busy={isSaving} className="w-full sm:w-auto">
          {isSaving ? "Saving…" : "Save changes"}
        </Button>
      </form>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Profile</CardTitle>
        <CardDescription>
          Update the details other traders see when you buy, sell, or trade.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="displayName">Display name</Label>
            <Input
              id="displayName"
              name="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={255}
              autoComplete="name"
              aria-invalid={displayNameError ? true : undefined}
              aria-describedby={
                displayNameError ? "displayName-error" : undefined
              }
              disabled={isSaving}
            />
            {displayNameError ? (
              <p
                id="displayName-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {displayNameError}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="contactEmail">Contact email</Label>
            <Input
              id="contactEmail"
              name="contactEmail"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              maxLength={255}
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={contactEmailError ? true : undefined}
              aria-describedby={
                contactEmailError ? "contactEmail-error" : undefined
              }
              disabled={isSaving}
            />
            {contactEmailError ? (
              <p
                id="contactEmail-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {contactEmailError}
              </p>
            ) : null}
          </div>

          {generalError ? (
            <p role="alert" className="text-sm text-destructive">
              {generalError}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="border-t px-6 py-4 sm:justify-end">
          <Button type="submit" disabled={isSaving} aria-busy={isSaving} className="w-full sm:w-auto">
            {isSaving ? "Saving…" : "Save changes"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
