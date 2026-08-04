'use client';

// components/arbitration/CaseNoteComposer.tsx
//
// Append an internal note to an arbitration case.
//
// WHY NOTES ARE APPEND-ONLY, AND WHY THE UI SAYS SO. A note is the record of what an
// arbitrator knew at the moment they moved someone's money. If it can be edited later,
// it stops being evidence of the decision and becomes a description of it — which is
// exactly the thing you cannot rely on when the decision is challenged. Migration 0047
// grants staff insert and select and nothing else, so this composer offers no edit or
// delete affordance because there is no such action to offer.
//
// Notes are STAFF-ONLY. There is no member-facing policy on `arbitration_notes` at all,
// so a party to the dispute cannot read them even through the API. The placeholder says
// so, because an arbitrator writing "buyer is almost certainly lying" needs to know
// with certainty whether the buyer will see it.

import { useRef, useState, useTransition } from 'react';
import { Loader2, MessageSquarePlus } from 'lucide-react';
import { toast } from 'sonner';

import { addArbitrationNote } from '@/lib/actions/arbitration';
import type { ArbitrationCaseKind } from '@/domain/arbitration/arbitrationCase';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const MAX_NOTE_LENGTH = 4_000;

const ERROR_MESSAGES: Record<string, string> = {
  'not-authenticated': 'Your session has expired. Please sign in again.',
  'not-authorized': 'You are not authorized to write case notes.',
  'validation-error': 'A note cannot be empty.',
  'persistence-error': 'The note could not be saved.',
};

export interface CaseNoteComposerProps {
  caseKind: ArbitrationCaseKind;
  caseRef: string;
}

export function CaseNoteComposer({ caseKind, caseRef }: CaseNoteComposerProps) {
  const [isPending, startTransition] = useTransition();
  const [body, setBody] = useState('');
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  const trimmed = body.trim();
  const tooLong = trimmed.length > MAX_NOTE_LENGTH;
  const canSubmit = trimmed.length > 0 && !tooLong && !isPending;
  const fieldId = `note-${caseKind}-${caseRef}`;

  function submit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await addArbitrationNote(caseKind, caseRef, trimmed);
      if (result.ok) {
        // Only clear on success. A provider or network failure that silently ate a
        // paragraph of reasoning is worse than a stale field.
        setBody('');
        fieldRef.current?.focus();
        toast.success('Note added.');
        return;
      }
      toast.error(result.message ?? ERROR_MESSAGES[result.error] ?? 'The note could not be saved.');
    });
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Label htmlFor={fieldId}>Add an internal note</Label>
      <Textarea
        id={fieldId}
        ref={fieldRef}
        value={body}
        rows={4}
        maxLength={MAX_NOTE_LENGTH}
        onChange={(event) => setBody(event.target.value)}
        placeholder="What you checked, what the evidence shows, what you are minded to decide. Visible to CardTrade staff only — never to either party."
        aria-describedby={`${fieldId}-help`}
        disabled={isPending}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={`${fieldId}-help`} className="text-xs text-muted-foreground">
          Notes cannot be edited or deleted once saved.{' '}
          <span className="tabular-nums">
            {trimmed.length}/{MAX_NOTE_LENGTH}
          </span>
        </p>
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <MessageSquarePlus aria-hidden />
          )}
          Save note
        </Button>
      </div>
    </form>
  );
}
