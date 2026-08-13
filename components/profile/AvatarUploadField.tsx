'use client';

// components/profile/AvatarUploadField.tsx
//
// The one avatar picker, shared by the profile form and onboarding so the two
// cannot drift in what they accept or what they say when they refuse.
//
// ALWAYS OPTIONAL. Onboarding already gates on Connect; a mandatory photo would add
// a drop-off point for zero safety gain, because an avatar is self-chosen and
// carries no assurance whatsoever. The Identity_Gate is the real signal.
//
// Saves immediately on pick rather than waiting for a surrounding form submit. The
// upload is already a two-step round trip (mint token, PUT to Storage), so
// deferring the persist would mean holding a File in state, re-uploading on a
// validation failure elsewhere in the form, and leaving orphaned objects when the
// member navigates away. Onboarding also has no save button of its own for this.

import * as React from 'react';
import { Camera, Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ALLOWED_AVATAR_TYPES } from '@/lib/storage/profileImagesShared';
import { clearAvatar, uploadAvatar } from '@/lib/storage/uploadAvatar';

export interface AvatarUploadFieldProps {
  /** Current stored object path, or null. */
  avatarPath: string | null;
  /** Name driving the initials fallback while there is no picture. */
  displayName: string;
  /** Called with the new path (or null) after a successful save. */
  onChange?: (avatarPath: string | null) => void;
  disabled?: boolean;
  /** Hides the explanatory line where the surrounding surface already says it. */
  hideHint?: boolean;
  /**
   * Render the picker as a small camera badge on the avatar instead of a labelled
   * button beside it.
   *
   * NOT the default, deliberately. Onboarding shows this field to someone who has
   * never seen the app, where an explicit "Add a picture" button is worth the
   * space; a 24px glyph is far less discoverable. Settings is the opposite case —
   * the member came looking for it, and a full-width button beside a 64px avatar
   * dominates a row that is meant to be secondary to the name and email beside it.
   */
  compact?: boolean;
}

export function AvatarUploadField({
  avatarPath,
  displayName,
  onChange,
  disabled = false,
  hideHint = false,
  compact = false,
}: AvatarUploadFieldProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [path, setPath] = React.useState<string | null>(avatarPath);
  const [busy, setBusy] = React.useState<'upload' | 'clear' | null>(null);

  // The server is the source of truth: a parent that re-renders after its own save
  // should not be overwritten by stale local state.
  React.useEffect(() => setPath(avatarPath), [avatarPath]);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Clear the input so picking the SAME file again still fires a change event —
    // otherwise a member who fixes a rejected image cannot retry with it.
    event.target.value = '';
    if (!file) return;

    setBusy('upload');
    const result = await uploadAvatar(file);
    setBusy(null);

    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    setPath(result.avatarPath);
    onChange?.(result.avatarPath);
    toast.success('Picture updated');
  }

  async function handleClear() {
    setBusy('clear');
    const result = await clearAvatar();
    setBusy(null);

    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    setPath(null);
    onChange?.(null);
    toast.success('Picture removed');
  }

  const isBusy = busy !== null;
  const controlsDisabled = disabled || isBusy;

  // Declared once and rendered by whichever branch runs below. `accept` is
  // advisory only; the bucket and the server both enforce the real allowlist,
  // because a signed upload never passes through our server.
  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={ALLOWED_AVATAR_TYPES.join(',')}
      onChange={handleFile}
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
    />
  );

  if (compact) {
    return (
      <div className="flex flex-col items-center gap-1.5">
        <div className="relative">
          <Avatar avatarPath={path} displayName={displayName} size="xl" />
          {/* The badge IS the picker. `aria-label` carries the whole meaning here,
              since the glyph is the only visible content — without it a screen
              reader announces an unlabelled button. */}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={controlsDisabled}
            aria-busy={busy === 'upload'}
            aria-label={path ? 'Change picture' : 'Add a picture'}
            className="absolute -bottom-0.5 -right-0.5 grid size-7 place-items-center rounded-full border-2 border-card bg-primary text-primary-foreground transition-colors hover:bg-primary/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-65"
          >
            {busy === 'upload' ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Camera className="size-3.5" aria-hidden />
            )}
          </button>
        </div>

        {/* Kept, even though the reference has no equivalent: dropping it would
            remove the only way to delete a picture already uploaded. Rendered as a
            quiet text link so it does not reintroduce the button this variant
            exists to remove. */}
        {path ? (
          <button
            type="button"
            onClick={handleClear}
            disabled={controlsDisabled}
            aria-busy={busy === 'clear'}
            className="rounded-sm text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-65"
          >
            {busy === 'clear' ? 'Removing…' : 'Remove'}
          </button>
        ) : null}

        {fileInput}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar avatarPath={path} displayName={displayName} size="xl" />

      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={controlsDisabled}
            aria-busy={busy === 'upload'}
          >
            {busy === 'upload' ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Upload aria-hidden />
            )}
            {path ? 'Change picture' : 'Add a picture'}
          </Button>

          {path ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClear}
              disabled={controlsDisabled}
              aria-busy={busy === 'clear'}
            >
              {busy === 'clear' ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Trash2 aria-hidden />
              )}
              Remove
            </Button>
          ) : null}
        </div>

        {hideHint ? null : (
          <p className="text-xs text-muted-foreground">
            Optional. PNG, JPEG, or WebP, up to 2 MB. Shown next to your name on
            listings and in chats — it is not used to verify you.
          </p>
        )}
      </div>

      {fileInput}
    </div>
  );
}
