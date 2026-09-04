'use client';

// components/messages/MessageComposer.tsx
//
// Shared composer for the inbox thread and the contract room. Paperclip attaches
// one photo or PDF; Enter sends on a pointer device; the file can travel with
// or without a caption.

import { useEffect, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from 'react';
// `Plus` and `ArrowUp` rather than the paperclip-and-paper-plane pair every
// scaffold ships with. Both are the current chat vocabulary — a plus opens the
// attachment tray, an up arrow commits the line — and an arrow reads as "send"
// at 16px where a paper plane turns to mush.
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowUp01Icon, LoaderCircleIcon, PlusIcon, XIcon } from '@hugeicons/core-free-icons';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { sendMessage } from '@/lib/actions/messages';
import { uploadMessageAttachment } from '@/lib/storage/uploadMessageAttachment';
import {
  MESSAGE_ATTACHMENT_ACCEPT,
  MESSAGE_ATTACHMENT_MAX_BYTES,
  formatAttachmentBytes,
  isAllowedMessageAttachmentType,
  isImageAttachmentMime,
} from '@/lib/storage/messageAttachmentsShared';
import { MESSAGE_BODY_MAX } from '@/lib/marketplace-constants';
import {
  optimisticMessage,
  type MessageRow,
} from '@/lib/realtime/useConversationRealtime';
import { cn } from '@/lib/utils';

/**
 * Wiring that lets a sent message appear before the server has answered.
 *
 * Supplied by whoever owns the message list, because that is the only place an
 * optimistic row can be merged and later reconciled.
 */
export interface ComposerOptimistic {
  currentUserId: string;
  add: (message: MessageRow) => void;
  /** Replace the placeholder with the real row, or drop it if the send failed. */
  settle: (tempId: string, message: MessageRow | null) => void;
}

export interface MessageComposerProps {
  conversationId: string;
  placeholder?: string;
  inputId: string;
  /** Tighter field for the contract pane. */
  compact?: boolean;
  /** Omit to fall back to waiting for the round trip. */
  optimistic?: ComposerOptimistic;
}

export function MessageComposer({
  conversationId,
  placeholder = 'Write a message…',
  inputId,
  compact = false,
  optimistic,
}: MessageComposerProps) {
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  // Grow from one line rather than reserving two. Measured against a collapsed
  // box because `scrollHeight` never shrinks on its own — without the reset the
  // field would ratchet taller and never come back down after a deletion.
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = '0px';
    field.style.height = `${field.scrollHeight}px`;
  }, [draft]);

  useEffect(() => {
    if (!file || !isImageAttachmentMime(file.type)) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const trimmed = draft.trim();
  const canSend =
    (trimmed.length > 0 || file !== null) &&
    trimmed.length <= MESSAGE_BODY_MAX &&
    !isPending;

  function attach(next: File | null) {
    if (!next) {
      setFile(null);
      return;
    }
    if (!isAllowedMessageAttachmentType(next.type)) {
      setError('Attach a photo or a PDF.');
      return;
    }
    if (next.size > MESSAGE_ATTACHMENT_MAX_BYTES) {
      setError('That file is larger than 10 MB.');
      return;
    }
    setError(null);
    setFile(next);
  }

  function handleSubmit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) return;
    const body = trimmed;
    const pending = file;
    setError(null);

    // CLEARED NOW, NOT ON THE SERVER'S ANSWER. The field used to hold the text
    // until `sendMessage` resolved and the bubble only appeared when the
    // realtime INSERT echoed back — two round trips of the composer sitting
    // there full, which is the lag you feel. The draft is kept in `body` so a
    // failure can put it straight back.
    setDraft('');
    setFile(null);

    // A text-only send is echoed locally straight away. An attachment is not:
    // its bubble needs a signed URL that only exists after the upload, and a
    // placeholder with a broken image is worse than a moment's wait.
    const placeholder =
      optimistic && !pending
        ? optimisticMessage({
            conversationId,
            senderId: optimistic.currentUserId,
            body,
          })
        : null;
    if (placeholder && optimistic) optimistic.add(placeholder);

    startTransition(async () => {
      let attachment:
        | { path: string; name: string; mime: string; bytes: number }
        | undefined;
      if (pending) {
        const uploaded = await uploadMessageAttachment(pending);
        if (!uploaded.ok) {
          setError(uploaded.message);
          setDraft(body);
          setFile(pending);
          return;
        }
        attachment = {
          path: uploaded.path,
          name: pending.name,
          mime: pending.type,
          bytes: pending.size,
        };
      }
      const result = await sendMessage(conversationId, body, attachment);
      if (result.ok) {
        if (placeholder && optimistic) {
          optimistic.settle(placeholder.id, result.message);
        }
        return;
      }
      // Take the placeholder back out and hand the draft to the composer, so a
      // failed send never silently eats what someone typed.
      if (placeholder && optimistic) optimistic.settle(placeholder.id, null);
      setDraft(body);
      setFile(pending);
      setError(
        result.error === 'invalid-body'
          ? 'Message must be between 1 and 4000 characters.'
          : result.error === 'invalid-attachment'
            ? 'That file could not be attached. Try again.'
            : result.error === 'not-participant'
              ? 'You are no longer part of this conversation.'
              : 'Message could not be sent. Please try again.',
      );
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      window.matchMedia('(hover: hover)').matches
    ) {
      event.preventDefault();
      handleSubmit();
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        // `pb-0` is not a missing value. The shell gives a flush route 16px of
        // bottom padding, so the field is centred in the band under its rule
        // only when this supplies the matching 16px ABOVE and nothing below.
        // Add padding here and the field rides high again.
        // `px-group`, matching the thread's bar and log. It was `px-7` against a
        // 16px header, so the field sat 12px inside the title above it.
        compact ? 'border-t p-cozy' : 'border-t px-group pb-0 pt-4',
        // No surface of its own. It used to paint `--background` on a phone,
        // which is now a tint sitting on the white the thread and the room both
        // give it; the field's own `bg-muted` pill is what separates it.
        'max-md:border-border max-md:pt-4',
        compact ? 'max-md:px-0 max-md:pb-0' : 'max-md:px-cozy max-md:pb-0',
      )}
    >
      <label htmlFor={inputId} className="sr-only">
        Write a message
      </label>
      {file ? (
        <div className="mb-2 flex items-center gap-2 rounded-lg border bg-muted px-2 py-1.5">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="" className="size-10 rounded-md object-cover" />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-medium">{file.name}</p>
            <p className="text-meta text-muted-foreground">
              {formatAttachmentBytes(file.size)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => attach(null)}
            className="grid size-11 place-items-center rounded-full border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:border-iris md:size-8"
            aria-label="Remove attachment"
          >
            <HugeiconsIcon icon={XIcon} className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : null}
      {/* `items-center`, not `items-end`. The field is one line at rest now, so
          bottom-aligning the two round buttons against it left them sitting low
          against a box that was already too tall. Once the field grows past a
          couple of lines the buttons stay on its vertical centre, which is what
          every chat client does. */}
      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept={MESSAGE_ATTACHMENT_ACCEPT}
          className="sr-only"
          onChange={(event) => {
            attach(event.target.files?.[0] ?? null);
            event.target.value = '';
          }}
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          // The send button fills its box with ink; a bare glyph in an invisible
          // ghost box does not. On a phone that reads as ~28px of extra air on
          // the left and the field looks pushed off centre, so the plus takes
          // the same muted surface the field already wears there.
          className="size-11 shrink-0 max-md:rounded-full max-md:bg-muted md:size-10"
          aria-label="Attach a file"
          disabled={isPending}
          onClick={() => fileRef.current?.click()}
        >
          <HugeiconsIcon icon={PlusIcon} aria-hidden />
        </Button>
        <Textarea
          id={inputId}
          name="message"
          autoComplete="off"
          enterKeyHint="send"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={(event) => {
            const pasted = event.clipboardData.files[0];
            if (!pasted) return;
            event.preventDefault();
            attach(pasted);
          }}
          ref={fieldRef}
          placeholder={placeholder}
          maxLength={MESSAGE_BODY_MAX}
          rows={1}
          className={cn(
            // ONE LINE AT REST. `rows={2}` plus a 44px floor made the resting
            // field about 60px of empty box for a chat that is mostly short
            // replies. `py-2` against `leading-5` puts a single line at exactly
            // the 40px of the buttons beside it; the effect above grows it from
            // there, and `max-h` hands over to scrolling on a long paste.
            'max-h-32 min-h-10 resize-none overflow-y-auto py-2 text-body leading-5',
            compact && 'max-h-24',
            'max-md:min-h-11 max-md:rounded-2xl max-md:bg-muted',
          )}
          readOnly={isPending}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : undefined}
        />
        <Button
          type="submit"
          size="icon"
          className="size-11 shrink-0 md:size-10"
          disabled={!canSend}
          aria-label="Send message"
        >
          {isPending ? (
            <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
          ) : (
            <HugeiconsIcon icon={ArrowUp01Icon} aria-hidden />
          )}
        </Button>
      </div>
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="mt-2 text-body text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
