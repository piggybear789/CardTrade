'use client';

// components/profile/ProfileBioEditor.tsx
//
// The bio editor, now the body of a sheet opened from the Bio row rather than a
// textarea sitting open on the Settings page.
//
// WHY IT MOVED. It was inline on the reasoning that "a field that looks like a field
// needs no discovery" — true of a form, but Settings is read far more often than it
// is edited, and an always-open textarea carrying placeholder prose and a `0/280`
// counter made a screen at rest look like an abandoned draft. The row now states
// whether a bio is set and shows it; the field appears when asked for.
//
// Saves explicitly. Auto-saving prose on blur means a half-written sentence
// becomes your public bio the moment focus moves.

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Check, Loader2 } from 'lucide-react';

import { updateBio } from '@/lib/actions/profile';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/** Matches the server-side cap in `updateBio`. */
const BIO_MAX = 280;

export function ProfileBioEditor({
  initialBio,
  onSaved,
}: {
  initialBio: string;
  /** Raised after a successful save, so a host sheet can dismiss itself. */
  onSaved?: () => void;
}) {
  const [bio, setBio] = useState(initialBio);
  const [isPending, startTransition] = useTransition();
  const [justSaved, setJustSaved] = useState(false);

  const dirty = bio.trim() !== initialBio.trim();

  function save() {
    startTransition(async () => {
      try {
        const result = await updateBio(bio.trim() || null);
        if (!result.ok) {
          toast.error(result.message ?? 'Your bio could not be saved.');
          return;
        }
        setJustSaved(true);
        toast.success('Bio saved.');
        window.setTimeout(() => setJustSaved(false), 2000);
        onSaved?.();
      } catch {
        toast.error('Network error saving bio. Please try again.');
      }
    });
  }

  return (
    <div className="space-y-cozy">
      <Textarea
        value={bio}
        onChange={(event) => setBio(event.target.value.slice(0, BIO_MAX))}
        placeholder="Tell other collectors what you trade, how you pack, how fast you post…"
        rows={5}
        maxLength={BIO_MAX}
        disabled={isPending}
        aria-describedby="bio-counter"
        autoFocus
        className="resize-none"
      />
      <div className="flex items-center justify-between gap-cozy">
        {/* Not a live region: it updates on every keystroke, which would make a
            screen reader interrupt the user continuously as they type. */}
        <span id="bio-counter" className="text-meta text-muted-foreground">
          {bio.length}/{BIO_MAX}
        </span>
        {/* ALWAYS RENDERED, disabled until there is something to save. In a sheet the
            primary action cannot appear only once the field is dirty — opening an
            editor whose only visible control is the close button reads as broken. */}
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={isPending || !dirty}
          aria-busy={isPending}
        >
          {isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : justSaved && !dirty ? (
            <Check aria-hidden />
          ) : null}
          {justSaved && !dirty ? 'Saved' : 'Save bio'}
        </Button>
      </div>
    </div>
  );
}
