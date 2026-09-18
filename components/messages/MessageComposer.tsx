'use client';

// components/messages/MessageComposer.tsx
//
// Shared composer for the inbox thread and the contract room. The plus control
// attaches one photo or PDF; Enter sends and Shift+Enter starts a new line; the
// file can travel with or without a caption.

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  LoaderCircleIcon,
  PlusIcon,
  SendHorizontalIcon,
  XIcon,
} from '@hugeicons/core-free-icons';

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
import { MESSAGE_GUTTER } from '@/components/messages/threadGeometry';

/**
 * What each `sendMessage` failure says to the person who typed the message.
 *
 * A MAP, AND IT NAMES `unauthenticated`, which is the whole reason this exists. The
 * branch this replaced handled three codes and swept the rest into "Message could not be
 * sent. Please try again." — so a member whose session had expired was told to retry an
 * action that cannot succeed until they sign in, and the retry produced the same line
 * again. `MessageSellerButton` has always named this case; the two are now consistent.
 *
 * The draft and any attachment are handed back to the composer on every failure, so the
 * advice here is safe to follow: nothing typed is lost by signing in and returning.
 */
const SEND_ERROR_MESSAGES: Record<string, string> = {
  unauthenticated: 'You have been signed out. Sign in again to send this message.',
  'not-participant': 'You are no longer part of this conversation.',
  'invalid-body': 'Message must be between 1 and 4000 characters.',
  'invalid-attachment': 'That file could not be attached. Try again.',
  'persistence-error': 'Message could not be sent. Please try again.',
};

/** For a code this build does not know about — genuinely "try again" territory. */
const SEND_ERROR_FALLBACK = 'Message could not be sent. Please try again.';
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
  /**
   * Applied to a wrapper INSIDE the form, around the field and its buttons.
   *
   * For capping the field to the same reading column as the message log above it — see
   * `MESSAGE_COLUMN`. Deliberately not on the form: the form draws the rule that
   * separates the composer from the log, and that has to span the full pane.
   */
  contentClassName?: string;
  /** Omit to fall back to waiting for the round trip. */
  optimistic?: ComposerOptimistic;
}

export function MessageComposer({
  conversationId,
  placeholder = 'Write a message…',
  inputId,
  contentClassName,
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
      setError(SEND_ERROR_MESSAGES[result.error] ?? SEND_ERROR_FALLBACK);
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={isPending}
      className={cn(
        // The standalone inbox thread owns its complete dock. Keeping the 1rem
        // above and below in this one surface prevents the shell's tinted
        // background from appearing as a separate strip under the controls.
        //
        // The horizontal inset comes from `MESSAGE_GUTTER`, shared with the log and the
        // subject bar above it — a composer with its own idea of the inset steps away
        // from the bubbles it belongs to. The contract room's `compact` dock keeps its
        // own `p-cozy`: that pane is narrow and is not one of the bands this governs.
        compact ? 'border-t p-cozy' : 'border-t py-group',
        'max-md:border-border',
        compact
          ? 'max-md:pb-0 max-md:pl-[env(safe-area-inset-left)] max-md:pr-[env(safe-area-inset-right)]'
          : MESSAGE_GUTTER,
      )}
    >
      {/* The RULE spans the pane, its CONTENTS do not. `contentClassName` caps the field
          to the same column the message log uses, so the two agree; putting that cap on
          the form itself would pull the border-t in with it and leave the composer
          looking like a floating card rather than the bottom of the surface. */}
      <div className={cn('min-w-0', contentClassName)}>
      <label htmlFor={inputId} className="sr-only">
        Write a message
      </label>
      {file ? (
        <div className="mb-snug flex items-center gap-snug rounded-lg border bg-muted px-snug py-1.5">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt=""
              width={40}
              height={40}
              className="size-10 rounded-md object-cover"
            />
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
            className="grid size-11 place-items-center rounded-full border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:border-iris md:size-9"
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
      <div className="flex items-center gap-snug">
        <input
          ref={fileRef}
          type="file"
          aria-label="Attach a photo or PDF"
          accept={MESSAGE_ATTACHMENT_ACCEPT}
          className="sr-only"
          onChange={(event) => {
            attach(event.target.files?.[0] ?? null);
            event.target.value = '';
          }}
        />
        <Button
          type="button"
          size="icon-lg"
          variant="ghost"
          // The send button fills its box with ink; a bare glyph in an invisible
          // ghost box does not. On a phone that reads as ~28px of extra air on
          // the left and the field looks pushed off centre, so the plus takes
          // the same muted surface the field already wears there.
          className="shrink-0 max-md:rounded-full max-md:bg-muted"
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
            // Preserve ordinary paste. Mixed clipboard payloads often include a
            // fallback URL/text representation; attaching the file as well
            // would silently turn that fallback into an unintended caption.
            if (event.clipboardData.getData('text/plain').trim()) return;
            attach(pasted);
          }}
          ref={fieldRef}
          placeholder={placeholder}
          maxLength={MESSAGE_BODY_MAX}
          rows={1}
          className={cn(
            // THE SAME TYPE AS THE BUBBLES. `text-body` with the token's own
            // line-height (1.6 → 22.4px), and nothing else. This field used to be
            // `leading-5` on desktop and `text-base leading-6` on a phone, so what
            // you typed was set in a different size and rhythm from what it
            // became once sent — 16/24 in the field, 14/22.4 in the bubble. The
            // 16px was the iOS focus-zoom floor that `tailwind.config.ts` says was
            // removed everywhere and must not come back per component.
            //
            // ONE LINE AT REST, level with the `icon-lg` buttons beside it: 44px on
            // touch, 36px from `md`. Textareas do not distribute spare min-height
            // like flex items, so the padding is what centres the resting line —
            // 22.4 + 2×10 + 2px border ≈ 44; 22.4 + 2×6 + 2 ≈ 36. The effect above
            // grows it from there, and `max-h` hands over to scrolling.
            'max-h-32 min-h-11 resize-none overflow-y-auto py-2.5 text-body md:min-h-9 md:py-1.5',
            compact && 'max-h-24',
            'max-md:rounded-2xl max-md:bg-muted',
          )}
          readOnly={isPending}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : undefined}
        />
        <Button
          type="submit"
          size="icon-lg"
          className="shrink-0 max-md:rounded-full"
          disabled={!canSend}
          aria-label={isPending ? 'Sending message…' : 'Send message'}
        >
          {isPending ? (
            <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
          ) : (
            <HugeiconsIcon icon={SendHorizontalIcon} aria-hidden />
          )}
        </Button>
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {isPending ? 'Sending message…' : ''}
      </span>
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="mt-snug text-body text-destructive">
          {error}
        </p>
      ) : null}
      </div>
    </form>
  );
}
