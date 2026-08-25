'use client';

// components/profile/ProfileBioEditor.tsx
//
// The bio is always an editable textarea rather than a click-to-reveal control.
// The previous version rendered as plain text until clicked, which gave an empty
// bio no affordance at all — a line of placeholder italics that did not look
// interactive. A field that looks like a field needs no discovery.
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

export function ProfileBioEditor({ initialBio }: { initialBio: string }) {
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
      } catch {
        toast.error('Network error saving bio. Please try again.');
      }
    });
  }

  return (
    <div className="space-y-snug">
      <Textarea
        value={bio}
        onChange={(event) => setBio(event.target.value.slice(0, BIO_MAX))}
        placeholder="Tell other collectors what you trade, how you pack, how fast you post…"
        // Three rows on the empty phone form so Settings is not a tall blank
        // well. The field is still `resize-y` if someone writes the full 280.
        rows={3}
        maxLength={BIO_MAX}
        disabled={isPending}
        aria-describedby="bio-counter"
        className="resize-y"
      />
      <div className="flex items-center justify-between gap-cozy">
        {/* Not a live region: it updates on every keystroke, which would make a
            screen reader interrupt the user continuously as they type. */}
        <span id="bio-counter" className="text-meta text-muted-foreground">
          {bio.length}/{BIO_MAX}
        </span>
        {dirty || justSaved ? (
          <Button
            type="button"
            size="sm"
            onClick={save}
            disabled={isPending || !dirty}
            aria-busy={isPending}
          >
            {isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : justSaved ? (
              <Check aria-hidden />
            ) : null}
            {justSaved && !dirty ? 'Saved' : 'Save bio'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
