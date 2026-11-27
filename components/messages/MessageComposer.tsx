'use client';

// components/messages/MessageComposer.tsx
//
// Shared composer for the inbox thread and the contract room. The plus control
// attaches one photo or PDF; Enter sends and Shift+Enter starts a new line; the
// file can travel with or without a caption.
//
// ONE PILL, NOT THREE CONTROLS (2026-11-28, design-system audit). The composer was a
// ghost "+" button, a bordered textarea and a filled send square, three objects with
// three edges on one line. Every chat client members already use (Instagram, WhatsApp,
// iMessage, Messenger; Mobbin, 2026-11-28) draws ONE rounded field that holds its own
// controls: attach at the start, send at the end, the text between. So does this one:
//
//   ( + )  Write a message…                                   ( ➤ )
//
//   - THE PILL IS THE FIELD. It carries the control edge (`border-input`, firming on
//     hover) and the focus edge (`border-ring` plus a faint halo) for everything inside
//     it; the textarea inside is borderless and transparent.
//   - A PILL, deliberately, against the "a control is never a pill" rule in
//     `tailwind.config.ts`. A chat field is the one control every reference draws as
//     a capsule, and the bubbles above it are near-pills too: the conversation has its
//     own shape language (see `MESSAGE_BUBBLE_RADIUS` in `MessageLog`).
//   - SEND IS THE BUBBLE'S COLOUR. Your messages are `--iris-ink` bubbles, so the
//     button that makes one is the same violet, and only once there is something to
//     send; empty, it is a quiet glyph that still holds its place, so the field never
//     changes width as you type.
//   - AN ATTACHMENT GOES INSIDE THE PILL, above the text line, the way Instagram shows
//     a photo you are about to send: it is part of the message being written, not a
//     separate card hovering over the composer.
//   - CONTROLS SIT ON THE LAST LINE (`items-end`). Once the field grows, attach and send
//     stay beside the line you are typing on, as every chat client keeps them.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Icon } from '@/components/ui/icon';
import {
  CircleNotchIcon,
  FileTextIcon,
  PaperPlaneRightIcon,
  PlusIcon,
  XIcon,
} from '@/components/ui/icons';

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
import {
  optimisticMessage,
  type MessageRow,
} from '@/lib/realtime/useConversationRealtime';
import { cn } from '@/lib/utils';

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
  'rate-limited': 'You are sending messages too quickly. Wait a moment and try again.',
  'persistence-error': 'Message could not be sent. Please try again.',
};

/** For a code this build does not know about — genuinely "try again" territory. */
const SEND_ERROR_FALLBACK = 'Message could not be sent. Please try again.';

/**
 * The round controls inside the pill: 40px on touch, 36px from `md`, the same two
 * heights as every other control (`button.tsx`). The field's resting line is padded to
 * the same box, so one line of text, the plus and the send button share a centre.
 */
const PILL_CONTROL =
  'grid size-10 shrink-0 touch-manipulation place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:size-9';

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
   * Applied to a wrapper INSIDE the form, around the pill.
   *
   * For capping the field to the same reading column as the message log above it — see
   * `MESSAGE_COLUMN`. Deliberately not on the form: the form spans the pane, and the
   * pill inside it is what lines up with the bubbles.
   */
  contentClassName?: string;
  /**
   * One standing line drawn above the pill, inside the dock: the inbox thread's "No
   * contract yet" note. Part of the composer so the dock is one band with one inset,
   * rather than a tinted strip stacked on top of it.
   */
  notice?: ReactNode;
  /** Omit to fall back to waiting for the round trip. */
  optimistic?: ComposerOptimistic;
}

export function MessageComposer({
  conversationId,
  placeholder = 'Write a message…',
  inputId,
  contentClassName,
  compact = false,
  notice,
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
  //
  // A LAYOUT EFFECT, so the new height lands before paint. As a passive effect every
  // keystroke that wrapped a line painted one frame at the old height — the text
  // jumped inside a scrolling box, then the box jumped — and the thread above, whose
  // height is whatever the composer leaves it, jumped with it.
  //
  // The border is added back because `scrollHeight` excludes it. The field inside the
  // pill has none today (the pill draws the edge), so this is 0; it stays so that a
  // border added later cannot leave the field 2px short of its content again.
  //
  // An EMPTY field is not measured: `scrollHeight` counts the placeholder, and a
  // field measured while its container was still narrow (the phone room mounts the
  // composer before its column has its final width) wrapped the placeholder onto
  // several lines and kept that height. Width changes re-measure for the same reason.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const measure = () => {
      if (!field.value) {
        field.style.height = '';
        return;
      }
      field.style.height = '0px';
      const border = field.offsetHeight - field.clientHeight;
      field.style.height = `${field.scrollHeight + border}px`;
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (field.clientWidth === width) return;
      width = field.clientWidth;
      measure();
    });
    observer.observe(field);
    return () => observer.disconnect();
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
  const hasContent = trimmed.length > 0 || file !== null;
  const canSend = hasContent && trimmed.length <= MESSAGE_BODY_MAX && !isPending;

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
    const placeholderMessage =
      optimistic && !pending
        ? optimisticMessage({
            conversationId,
            senderId: optimistic.currentUserId,
            body,
          })
        : null;
    if (placeholderMessage && optimistic) optimistic.add(placeholderMessage);

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
        if (placeholderMessage && optimistic) {
          optimistic.settle(placeholderMessage.id, result.message);
        }
        return;
      }
      // Take the placeholder back out and hand the draft to the composer, so a
      // failed send never silently eats what someone typed.
      if (placeholderMessage && optimistic) optimistic.settle(placeholderMessage.id, null);
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
        // NO RULE ABOVE IT. The pill's own edge is the boundary between the log and
        // the field, as on Instagram; a `border-t` as well drew a second line a few
        // pixels above the first. `bg-card` stays so the shell's tinted background
        // can never show through as a strip under the controls.
        //
        // The horizontal inset comes from `MESSAGE_GUTTER`, shared with the log and the
        // subject bar above it — a composer with its own idea of the inset steps away
        // from the bubbles it belongs to. The contract room's `compact` dock keeps its
        // own `px-cozy`: that pane is narrow and is not one of the bands this governs.
        'relative shrink-0 bg-card',
        compact
          ? // At least the `px-cozy` inset on a phone: with the safe-area inset alone (0 on
            // most phones) the pill ran flush against the screen edges.
            'px-cozy pb-cozy pt-snug max-md:pl-[max(0.75rem,env(safe-area-inset-left))] max-md:pr-[max(0.75rem,env(safe-area-inset-right))]'
          : cn('pb-group pt-snug', MESSAGE_GUTTER),
      )}
    >
      <div className={cn('relative min-w-0', contentClassName)}>
        <label htmlFor={inputId} className="sr-only">
          Write a message
        </label>
        {notice ? <div className="mb-snug">{notice}</div> : null}

        <div
          className={cn(
            // 22px corners: half the resting height, so one line is a true capsule
            // and a grown field or an attachment turns it into a rounded panel
            // without the corners changing.
            'flex min-w-0 flex-col rounded-[1.375rem] border bg-card transition-[border-color,box-shadow] duration-150',
            error
              ? 'border-destructive/60'
              : 'border-input hover:border-input-hover focus-within:border-ring focus-within:hover:border-ring',
            // The halo is the softness; the 1px `--ring` edge is the indicator, and
            // it is the same firm slate every field in the app focuses to.
            'focus-within:shadow-[0_0_0_3px_hsl(var(--ring)/0.08)]',
          )}
        >
          {file ? (
            <div className="flex items-center gap-snug px-snug pt-snug">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt=""
                  width={44}
                  height={44}
                  className="size-11 shrink-0 rounded-xl object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="grid size-11 shrink-0 place-items-center rounded-xl bg-foreground/[0.06] text-foreground/70"
                >
                  <Icon icon={FileTextIcon} className="size-5" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-medium">{file.name}</p>
                <p className="text-meta text-muted-foreground">
                  {formatAttachmentBytes(file.size)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => attach(null)}
                className={cn(PILL_CONTROL, 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground')}
                aria-label="Remove attachment"
              >
                <Icon icon={XIcon} className="size-4" />
              </button>
            </div>
          ) : null}

          <div className="flex items-end gap-tight p-1">
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
            <button
              type="button"
              className={cn(
                PILL_CONTROL,
                'text-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
              )}
              aria-label="Attach a file"
              disabled={isPending}
              onClick={() => fileRef.current?.click()}
            >
              <Icon icon={PlusIcon} className="size-[1.125rem]" />
            </button>
            <textarea
              ref={fieldRef}
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
              placeholder={placeholder}
              maxLength={MESSAGE_BODY_MAX}
              rows={1}
              className={cn(
                // THE SAME TYPE AS THE BUBBLES. `text-body` with the token's own
                // line-height (1.6 → 22.4px), and nothing else, so what you type is set
                // in the size and rhythm it will have once sent. The iOS focus-zoom
                // floor in `globals.css` still lifts it to 16px on an iPhone.
                //
                // ONE LINE AT REST, level with the round controls beside it: 40px on
                // touch, 36px from `md`. Textareas do not distribute spare min-height
                // like flex items, so the padding is what centres the resting line —
                // 22.4 + 2×9 ≈ 40; 22.4 + 2×7 ≈ 36. The effect above grows it from
                // there, and `max-h` hands over to scrolling.
                'min-h-10 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-tight py-[0.5625rem] text-body text-foreground outline-none placeholder:text-muted-foreground md:min-h-9 md:py-[0.4375rem]',
                // Keeps the caret clear of the phone keyboard when the page scrolls a
                // focused field into view, as the `Textarea` primitive does.
                'scroll-mb-[calc(6rem+var(--keyboard-inset,0px))] touch-manipulation',
                compact ? 'max-h-24' : 'max-h-32',
              )}
              readOnly={isPending}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${inputId}-error` : undefined}
            />
            <button
              type="submit"
              className={cn(
                PILL_CONTROL,
                hasContent || isPending
                  ? // White inside the violet, as filled buttons draw their focus frame in
                    // their own label colour (`button.tsx`).
                    'bg-iris-ink text-white hover:bg-iris-ink/90 active:bg-iris-ink/80 focus-visible:ring-white'
                  : 'text-muted-foreground/60',
                'disabled:cursor-default',
              )}
              disabled={!canSend}
              aria-label={isPending ? 'Sending message…' : 'Send message'}
            >
              {isPending ? (
                <Icon icon={CircleNotchIcon} className="size-[1.125rem] animate-spin" />
              ) : (
                <Icon icon={PaperPlaneRightIcon} className="size-[1.125rem]" />
              )}
            </button>
          </div>
        </div>

        <span className="sr-only" role="status" aria-live="polite">
          {isPending ? 'Sending message…' : ''}
        </span>
        {/* FLOATS ABOVE THE COMPOSER rather than growing it. Rendered in flow, a send
            failure added a line under the field, which made the composer taller, which
            shrank the thread above and lifted the contract room's action dock — the
            whole conversation moved because a request failed. */}
        {error ? (
          <p
            id={`${inputId}-error`}
            role="alert"
            className="absolute inset-x-0 bottom-full z-10 mb-snug rounded-xl bg-card px-cozy py-snug text-body text-destructive shadow-md ring-1 ring-destructive/30"
          >
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
