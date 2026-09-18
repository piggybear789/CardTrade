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
import { HugeiconsIcon } from '@hugeicons/react';
import { Camera01Icon, Delete02Icon, LoaderCircleIcon, Upload01Icon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
  const [menuOpen, setMenuOpen] = React.useState(false);

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
    // The whole circle is the control — members tap the initials, not a 24px camera
    // badge. The badge is the visual cue; `aria-label` is what a screen reader hears.
    const circle = (
      <button
        type="button"
        disabled={controlsDisabled}
        aria-busy={isBusy}
        aria-label={path ? 'Picture options' : 'Add a picture'}
        className="group relative cursor-pointer rounded-full border-0 bg-transparent p-0 focus:outline-none focus-visible:ring-2 focus-visible:border-iris focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-65"
      >
        <Avatar avatarPath={path} displayName={displayName} size="md" />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full bg-transparent transition-colors group-hover:bg-foreground/10 group-disabled:bg-transparent"
        />
        <span
          aria-hidden
          className="absolute -bottom-0.5 -right-0.5 grid size-6 place-items-center rounded-full border-2 border-card bg-primary text-primary-foreground transition-colors group-hover:bg-primary/85"
        >
          {isBusy ? (
            <HugeiconsIcon icon={LoaderCircleIcon} className="size-3.5 animate-spin" />
          ) : (
            <HugeiconsIcon icon={Camera01Icon} className="size-3" />
          )}
        </span>
      </button>
    );

    // ONE CONTROL. With no picture yet there is one thing to do, so the circle opens
    // the file picker directly. With a picture there are two — change or remove —
    // and they live in a small menu off the same circle. A "Remove" text link used
    // to hang under the avatar for this; stacked in flow it made the column taller
    // than the circle and mis-centred the avatar against the name beside it, and
    // pulled out of flow it was a dangling word under a picture. The menu is the
    // same pattern as the contract room's ⋯: secondary actions behind the primary.
    return (
      <div className="flex items-center">
        {path ? (
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>{circle}</PopoverTrigger>
            <PopoverContent align="start" className="w-44 p-tight">
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    inputRef.current?.click();
                  }}
                  className="flex h-9 w-full items-center gap-snug rounded-sm px-2.5 text-left text-body font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:bg-accent"
                >
                  <HugeiconsIcon icon={Camera01Icon} className="size-4 text-muted-foreground" aria-hidden />
                  Change picture
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    void handleClear();
                  }}
                  className="flex h-9 w-full items-center gap-snug rounded-sm px-2.5 text-left text-body font-medium text-destructive transition-colors hover:bg-destructive/10 focus:outline-none focus-visible:bg-destructive/10"
                >
                  <HugeiconsIcon icon={Delete02Icon} className="size-4" aria-hidden />
                  Remove picture
                </button>
              </div>
            </PopoverContent>
          </Popover>
        ) : (
          React.cloneElement(circle, { onClick: () => inputRef.current?.click() })
        )}

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
              <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
            ) : (
              <HugeiconsIcon icon={Upload01Icon} aria-hidden />
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
                <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
              ) : (
                <HugeiconsIcon icon={Delete02Icon} aria-hidden />
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
