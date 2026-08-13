'use client';

// components/profile/ProfileBioEditor.tsx
//
// Inline bio/description editor. Shows as plain text until clicked, then
// becomes an editable textarea. Saves on blur or explicit save.

import { useState, useTransition, useRef } from 'react';
import { toast } from 'sonner';
import { Loader2, Pencil } from 'lucide-react';

import { updateBio } from '@/lib/actions/profile';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

const BIO_MAX = 280;

export function ProfileBioEditor({ initialBio }: { initialBio: string }) {
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState(initialBio);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function startEditing() {
    setEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function save() {
    if (bio.trim() === initialBio.trim()) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      const result = await updateBio(bio.trim() || null);
      if (result.ok) {
        toast.success('Bio updated.');
        setEditing(false);
      } else {
        toast.error('Could not save.');
      }
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={startEditing}
        className="group flex w-full items-start gap-2 rounded-md text-left"
      >
        <p className={`min-h-[1.5rem] flex-1 text-sm ${bio ? 'text-foreground' : 'text-muted-foreground italic'}`}>
          {bio || 'Add a short bio...'}
        </p>
        <Pencil className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <Textarea
        ref={textareaRef}
        value={bio}
        onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
        placeholder="Tell other traders about yourself..."
        rows={3}
        maxLength={BIO_MAX}
        disabled={isPending}
        className="resize-none text-sm"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{bio.length}/{BIO_MAX}</span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => { setBio(initialBio); setEditing(false); }}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={save}
            disabled={isPending}
            aria-busy={isPending}
          >
            {isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
