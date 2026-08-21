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
   * NOT the default, but BOTH current callers pass it. Settings wants it because the
   * member came looking for the control, and a labelled button beside a 64px avatar
   * dominates a row meant to be secondary to the name and email next to it. Onboarding
   * wants it because the picture is optional and marked so: a labelled Upload button
   * plus a Remove button gave an optional field louder controls and more vertical space
   * than the required display name above it. The surrounding label carries the
   * discoverability the button used to.
   *
   * The default stays as it is because it is the accessible-by-default shape — a
   * labelled button rather than a glyph — and a third caller with room for it should
   * get that without opting in.
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
      <div className="flex flex-col items-center gap-tight">
        {/* The whole circle is the picker — members tap the initials, not a 28px
            camera badge. The badge stays as the visual cue; `aria-label` is what
            a screen reader hears because the glyph is not labelled text. */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={controlsDisabled}
          aria-busy={busy === 'upload'}
          aria-label={path ? 'Change picture' : 'Add a picture'}
          className="group relative cursor-pointer rounded-full border-0 bg-transparent p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-65"
        >
          <Avatar avatarPath={path} displayName={displayName} size="xl" />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full bg-transparent transition-colors group-hover:bg-foreground/10 group-disabled:bg-transparent"
          />
          <span
            aria-hidden
            className="absolute -bottom-0.5 -right-0.5 grid size-7 place-items-center rounded-full border-2 border-card bg-primary text-primary-foreground transition-colors group-hover:bg-primary/85"
          >
            {busy === 'upload' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Camera className="size-3.5" />
            )}
          </span>
        </button>

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
            className="rounded-sm text-meta text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline border border-transparent focus:outline-none focus-visible:border-gold/40 disabled:opacity-65"
          >
            {busy === 'clear' ? 'Removing…' : 'Remove'}
          </button>
        ) : null}

        {fileInput}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-group">
      <Avatar avatarPath={path} displayName={displayName} size="xl" />

      <div className="min-w-0 space-y-snug">
        <div className="flex flex-wrap items-center gap-snug">
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
          <p className="text-body text-muted-foreground">
            Optional. PNG, JPEG, or WebP, up to 2 MB. Shown next to your name on
            listings and in chats — it is not used to verify you.
          </p>
        )}
      </div>

      {fileInput}
    </div>
  );
}
