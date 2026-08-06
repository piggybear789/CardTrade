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
import { Loader2, Trash2, Upload } from 'lucide-react';
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
}

export function AvatarUploadField({
  avatarPath,
  displayName,
  onChange,
  disabled = false,
  hideHint = false,
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

      {/* `accept` is advisory only; the bucket and the server both enforce the
          real allowlist, because a signed upload never passes through our server. */}
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_AVATAR_TYPES.join(',')}
        onChange={handleFile}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}
