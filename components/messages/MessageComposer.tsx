'use client';

// components/messages/MessageComposer.tsx
//
// Shared composer for the inbox thread and the contract room. Paperclip attaches
// one photo or PDF; Enter sends on a pointer device; the file can travel with
// or without a caption.

import { useEffect, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from 'react';
import { Loader2, Paperclip, Send, X } from 'lucide-react';

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
import { cn } from '@/lib/utils';

export interface MessageComposerProps {
  conversationId: string;
  placeholder?: string;
  inputId: string;
  /** Tighter field for the contract pane. */
  compact?: boolean;
}

export function MessageComposer({
  conversationId,
  placeholder = 'Write a message…',
  inputId,
  compact = false,
}: MessageComposerProps) {
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement | null>(null);

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
    startTransition(async () => {
      let attachment:
        | { path: string; name: string; mime: string; bytes: number }
        | undefined;
      if (pending) {
        const uploaded = await uploadMessageAttachment(pending);
        if (!uploaded.ok) {
          setError(uploaded.message);
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
        setDraft('');
        setFile(null);
        return;
      }
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
        compact ? 'border-t p-cozy' : 'border-t pt-4',
        'max-md:border-border max-md:bg-background max-md:pt-2',
        compact ? 'max-md:px-0 max-md:pb-0' : 'max-md:pb-0',
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
            className="grid size-11 place-items-center rounded-full border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:border-gold/40 md:size-8"
            aria-label="Remove attachment"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : null}
      <div className="flex items-end gap-2">
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
          className="size-11 shrink-0 md:size-10"
          aria-label="Attach a file"
          disabled={isPending}
          onClick={() => fileRef.current?.click()}
        >
          <Paperclip aria-hidden />
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
          placeholder={placeholder}
          maxLength={MESSAGE_BODY_MAX}
          rows={compact ? 1 : 2}
          className={cn(
            'resize-none text-body',
            compact ? 'max-h-24 min-h-10' : 'min-h-[44px]',
            'max-md:rounded-2xl max-md:bg-muted max-md:min-h-11',
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
          {isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
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
