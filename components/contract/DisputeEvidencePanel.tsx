'use client';

// components/contract/DisputeEvidencePanel.tsx
//
// The Dispute tab both contract rooms render once a contract is DISPUTED (0082).
//
// WHAT IT IS FOR. Before this existed an arbitrator decided a four-figure capture on one
// sentence from one side, and the accused party had no channel to answer at all. Chat
// was the de-facto substitute, which is worse than it sounds: unstructured, interleaved
// with handover coordination, and with no notion of "this is my formal account".
//
// TWO DESIGN CHOICES WORTH DEFENDING:
//
//   1. BOTH PARTIES SEE EVERYTHING. A hidden-evidence model would mean deciding against
//      someone on material they never saw. The panel therefore shows the other side's
//      submissions in full, and says so before you write, so nobody submits under a
//      mistaken belief about who reads it.
//   2. SUBMISSIONS ARE FINAL. There is no edit or delete. A statement is what a party
//      asserted at a moment in a dispute, and editable evidence is not evidence — the
//      same reasoning as the staff notes composer. The UI states this plainly rather
//      than letting someone discover it after the fact.
//
// FOUR BLOCKS, EACH A DIFFERENT SHAPE. The first version of this tab was seven
// paragraphs of muted prose with two headings and two buttons somewhere in the middle,
// and on a phone it read as a wall. Every sentence was defensible on its own; the
// problem was that they all looked the same. So the tab is now built from blocks a
// reader can tell apart before reading a word of them:
//
//   THE CLAIM       a tinted card. The one thing everything below responds to, so it is
//                   the one thing that gets a surface. Reason quoted large; who raised
//                   it and when as chips. Nothing else.
//   SETTLE IT       a list of action rows (`components/ui/dialog-row` shape): label,
//                   one-line consequence, chevron. The old "End this without support"
//                   heading plus a sentence plus two outline buttons made the reader
//                   assemble the meaning; the row states it.
//   EVIDENCE        a timeline. Each entry is a card with an avatar so two parties'
//                   statements are visually distinct without reading the byline.
//   YOUR ACCOUNT    the composer, COLLAPSED behind one button once the record has
//                   anything in it. It is the tallest thing on the tab and only one
//                   person at a time is about to use it. With nothing on file yet it
//                   opens by default, because then it IS the empty state — a "nothing
//                   yet" placeholder above a form asking you to add something is the
//                   same message twice.
//
// NO FLAVOUR TEXT. Every sentence that explained, reassured or framed has gone; the
// only prose left is a consequence under an action, a placeholder inside a field, and
// a chip. The two facts a member must not be surprised by — that both sides and staff
// see everything, and that submissions are final — are each stated once, as a chip
// beside the thing they qualify, not as a paragraph above it. The confirm dialogs on
// the settle rows carry the full consequence at the moment it matters.
//
// NO CARD CHROME OF ITS OWN. This mounts inside a `ContractDetailRow` tabpanel, which
// already draws the bordered card and the "Dispute" tab header. The claim card is the
// exception, and it earns its surface by being the subject of the tab rather than a
// section of it.
//
// The panel owns no server action of its own beyond the evidence ones: raising or
// resolving a dispute stays with each room, because the two flows freeze and settle
// differently.

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import Image from 'next/image';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  EyeIcon,
  LoaderCircleIcon,
  LockIcon,
  PaperclipIcon,
  PlusIcon,
  SendHorizontalIcon,
  ShieldAlertIcon,
  XIcon,
} from '@hugeicons/core-free-icons';

import {
  submitDisputeEvidence,
  type DisputeCaseKind,
  type DisputeEvidenceEntry,
} from '@/lib/actions/disputeEvidence';
import { uploadDisputeEvidence } from '@/lib/storage/uploadDisputeEvidence';
import {
  EVIDENCE_ACCEPT,
  EVIDENCE_FILES_MAX,
  EVIDENCE_STATEMENT_MAX,
  EVIDENCE_STATEMENT_MIN,
  isVideoPath,
} from '@/lib/storage/disputeEvidenceShared';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatContractDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ContractImageLightbox } from '@/components/contract/ContractImageLightbox';

export interface DisputeEvidencePanelProps {
  caseKind: DisputeCaseKind;
  caseRef: string;
  /** Every submission on this contract, oldest first. Both parties' included. */
  entries: DisputeEvidenceEntry[];
  /** The reason recorded when the dispute was raised, if any. */
  disputeReason?: string | null;
  /** Who raised it, for attributing the reason. */
  raisedByName?: string | null;
  /** When it was raised, for stamping the claim. */
  disputedAt?: string | null;
  /** False once the case is decided: the record stays readable, the form goes away. */
  canSubmit?: boolean;
  /**
   * Room-specific controls for ending the dispute without an arbitrator — withdraw,
   * or concede (0084).
   *
   * A SLOT RATHER THAN BUILT IN, for the reason `components/fulfilment` gives: this
   * panel is shared by both contract rooms, and the two flows end a dispute
   * differently. A cash sale can be withdrawn or conceded because raising it moved no
   * money; a trade Condition_Dispute has already captured $20 from the counterparty
   * and paid $10 to the raiser, so it has no safe equivalent yet. Owning the buttons
   * here would mean this component knowing which flow it is in.
   */
  resolution?: ReactNode;
}

/** A small tinted label inside the claim card. */
function ClaimChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-sm border border-destructive/30 bg-card px-snug py-0.5 text-meta font-medium text-destructive">
      {children}
    </span>
  );
}

/** One attachment, rendered as a thumbnail or a video frame. */
function MediaTile({
  path,
  url,
  onOpen,
}: {
  path: string;
  url: string | null;
  onOpen?: () => void;
}) {
  const video = isVideoPath(path);

  if (!url) {
    return (
      <div className="grid aspect-square place-items-center rounded-lg border border-border bg-muted text-muted-foreground">
        <span className="px-snug text-center text-meta leading-tight">
          Attachment unavailable
        </span>
      </div>
    );
  }

  if (video) {
    return (
      // `controls` and nothing else: no autoplay, no loop. This is evidence being
      // examined, not media being consumed, and an arbitrator scrubs it deliberately.
      <video
        src={url}
        controls
        preload="metadata"
        className="aspect-square w-full rounded-lg border bg-obsidian object-contain"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative aspect-square overflow-hidden rounded-lg border focus:outline-none focus-visible:border-iris"
    >
      {/* Unoptimised: these are signed, short-lived URLs on a private bucket, so the
          image optimiser cannot cache them and would only add a hop that expires. */}
      <Image
        src={url}
        alt="Dispute evidence"
        fill
        unoptimized
        className="object-cover transition-transform group-hover:scale-105"
      />
    </button>
  );
}

/**
 * One party's submission, as a card in the timeline.
 *
 * THE AVATAR IS THE SPEAKER. Two parties alternate here and the arbitrator reads it
 * top to bottom; a byline alone makes them re-read the name on every entry to keep
 * track of who is talking. Initials in a circle do that at a glance, the way a chat
 * does. The avatar and the "You" byline are the only markers of whose entry it is —
 * no tint on your own cards; every entry is the same white card.
 */
function EvidenceEntry({ entry }: { entry: DisputeEvidenceEntry }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const photoUrls = entry.media.flatMap((media) =>
    media.url && !isVideoPath(media.path) ? [media.url] : [],
  );

  return (
    <li className="rounded-lg border border-border bg-card p-cozy">
      <div className="flex items-center gap-snug">
        <Avatar displayName={entry.authorName} size="xs" />
        <p className="min-w-0 flex-1 truncate text-body font-semibold">
          {entry.mine ? 'You' : entry.authorName}
        </p>
        <time
          dateTime={entry.createdAt}
          className="shrink-0 text-meta tabular-nums text-muted-foreground"
        >
          {formatContractDateTime(entry.createdAt) ?? entry.createdAt}
        </time>
      </div>
      <p className="mt-snug whitespace-pre-line break-words text-body">{entry.statement}</p>
      {entry.media.length > 0 ? (
        <div className="mt-cozy grid grid-cols-4 gap-snug sm:grid-cols-5">
          {entry.media.map((media) => {
            const photoIndex =
              media.url && !isVideoPath(media.path) ? photoUrls.indexOf(media.url) : -1;
            return (
              <MediaTile
                key={media.path}
                path={media.path}
                url={media.url}
                onOpen={photoIndex >= 0 ? () => setLightboxIndex(photoIndex) : undefined}
              />
            );
          })}
        </div>
      ) : null}
      <ContractImageLightbox
        images={photoUrls}
        openIndex={lightboxIndex}
        onOpenChange={setLightboxIndex}
        label="Dispute evidence"
      />
    </li>
  );
}

export function DisputeEvidencePanel({
  caseKind,
  caseRef,
  entries,
  disputeReason,
  raisedByName,
  disputedAt,
  canSubmit = true,
  resolution,
}: DisputeEvidencePanelProps) {
  const [statement, setStatement] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Open when there is nothing on file yet — the form is the empty state then. Once the
  // record has entries it folds behind a button; see the header note.
  const [composerOpen, setComposerOpen] = useState(entries.length === 0);
  const [confirming, setConfirming] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const statementRef = useRef<HTMLTextAreaElement | null>(null);

  const busy = uploading || isPending;
  const trimmed = statement.trim();
  const longEnough = trimmed.length >= EVIDENCE_STATEMENT_MIN;
  const ready = longEnough && !busy;
  const remaining = EVIDENCE_STATEMENT_MAX - statement.length;
  const stamped = disputedAt ? formatContractDateTime(disputedAt) : null;

  // THE DRAFT SURVIVES THE TAB. `ContractDetailList` swaps panels rather than hiding
  // them, so switching tabs unmounts this component, and on a phone the whole
  // inspector is a sheet. A member composing a careful account of being defrauded
  // lost it by tapping "History". Kept per case in `sessionStorage`, cleared on a
  // successful filing. Restore first, then save: `draftReady` gates the save so the
  // mount pass cannot write an empty string over the draft it is reading.
  const draftKey = `noditto:dispute-draft:${caseKind}:${caseRef}`;
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(draftKey);
      if (saved) {
        setStatement(saved);
        setComposerOpen(true);
      }
    } catch {
      // Private browsing and blocked storage both throw. A draft is a convenience.
    }
    setDraftReady(true);
  }, [draftKey]);
  useEffect(() => {
    if (!draftReady) return;
    try {
      if (statement) window.sessionStorage.setItem(draftKey, statement);
      else window.sessionStorage.removeItem(draftKey);
    } catch {
      // As above.
    }
  }, [draftKey, draftReady, statement]);

  function openComposer() {
    setComposerOpen(true);
    // Focus after the field mounts. A button that says "add your account" and then
    // leaves the caret where it was makes the member find the field themselves.
    requestAnimationFrame(() => statementRef.current?.focus());
  }

  function pickFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    if (picked.length > 0) {
      setFiles((prev) => [...prev, ...picked].slice(0, EVIDENCE_FILES_MAX));
    }
    // Reset so re-picking the same file fires a change event.
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit() {
    setError(null);

    // Bytes go browser -> Storage first; only the resulting paths reach the action, so a
    // 40 MB video never travels inside a Server Action body.
    let mediaPaths: string[] = [];
    if (files.length > 0) {
      setUploading(true);
      const uploaded = await uploadDisputeEvidence(files);
      setUploading(false);
      if (!uploaded.ok) {
        setError(uploaded.message);
        return;
      }
      mediaPaths = uploaded.paths;
    }

    startTransition(async () => {
      const result = await submitDisputeEvidence({
        caseKind,
        caseRef,
        statement: trimmed,
        mediaPaths,
      });
      setConfirming(false);
      if (result.ok) {
        setStatement('');
        setFiles([]);
        try {
          window.sessionStorage.removeItem(draftKey);
        } catch {
          // Nothing to do; the next mount would restore a filed statement, which
          // the empty `statement` above already prevents for this session.
        }
        // The record now has this entry; fold the form so the tab reads as a record
        // again rather than as a form with a record above it.
        setComposerOpen(false);
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div className="space-y-section">
      {/* THE CLAIM. The one surface on the tab, because it is the subject of the tab. */}
      {disputeReason ? (
        <section
          aria-labelledby="dispute-claim-heading"
          className="rounded-lg border border-destructive/30 bg-destructive/[0.06] p-group"
        >
          <div className="flex flex-wrap items-center gap-snug">
            <h3
              id="dispute-claim-heading"
              className="inline-flex items-center gap-tight text-meta font-semibold uppercase tracking-wide text-destructive"
            >
              <HugeiconsIcon icon={ShieldAlertIcon} className="size-4 shrink-0" aria-hidden />
              Dispute opened
            </h3>
            {raisedByName ? <ClaimChip>Raised by {raisedByName}</ClaimChip> : null}
            {stamped && disputedAt ? (
              <time dateTime={disputedAt} className="text-meta tabular-nums text-muted-foreground">
                {stamped}
              </time>
            ) : null}
          </div>
          {/* `text-body font-medium`, not a heading size. This is a member's own
              sentence being quoted; the eyebrow, chip and tint already say it is the
              claim, and setting free text at 17px semibold made a four-word reason
              shout. Weight alone lifts it off the chrome around it. */}
          <blockquote className="mt-snug whitespace-pre-line break-words text-pretty text-body font-medium">
            {disputeReason}
          </blockquote>
        </section>
      ) : null}

      {/* SETTLE IT. Room-specific; the rows themselves live in the slot. */}
      {resolution}

      {/* THE RECORD. Both sides, chronological. */}
      <section aria-labelledby="evidence-heading">
        <div className="flex flex-wrap items-center justify-between gap-x-cozy gap-y-tight">
          <h3 id="evidence-heading" className="text-body font-semibold">
            Evidence
            {entries.length > 0 ? (
              <span className="ml-snug rounded-full bg-muted px-snug py-0.5 text-meta font-medium tabular-nums text-muted-foreground">
                {entries.length}
              </span>
            ) : null}
          </h3>
          <span className="inline-flex items-center gap-tight text-meta text-muted-foreground">
            <HugeiconsIcon icon={EyeIcon} className="size-3.5 shrink-0" aria-hidden />
            Shared with both &amp; staff
          </span>
        </div>

        {entries.length > 0 ? (
          <ol className="mt-cozy space-y-snug">
            {entries.map((entry) => (
              <EvidenceEntry key={entry.id} entry={entry} />
            ))}
          </ol>
        ) : canSubmit ? null : (
          <p className="mt-cozy text-body text-muted-foreground">No evidence.</p>
        )}

        {/* YOUR ACCOUNT. Collapsed once the record has entries; opens inline. */}
        {canSubmit ? (
          composerOpen ? (
            <form
              className={cn(
                'space-y-group rounded-lg border border-border bg-card p-cozy',
                entries.length > 0 ? 'mt-snug' : 'mt-cozy',
              )}
              aria-labelledby="submit-heading"
              onSubmit={(event) => {
                event.preventDefault();
                // A confirmation, not a filing. This is the one irreversible control
                // in the room, and it used to be the only one that fired on a single
                // click while the reversible ones asked twice.
                if (ready) setConfirming(true);
              }}
            >
              <div className="flex items-center justify-between gap-cozy">
                <h4 id="submit-heading" className="text-body font-semibold">
                  Your account
                </h4>
                {entries.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setComposerOpen(false)}
                    disabled={busy}
                    className="grid size-8 place-items-center rounded-md border border-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:border-iris"
                    aria-label="Close"
                  >
                    <HugeiconsIcon icon={XIcon} className="size-4" aria-hidden />
                  </button>
                ) : null}
              </div>

              <div>
                <label htmlFor="evidence-statement" className="sr-only">
                  What happened, in your words
                </label>
                {/* The count lives inside the field's own border rather than floating
                    under it, so the control reads as one object. */}
                {/* `bg-card`, matching `Textarea`. `bg-background` is the tinted page
                    colour and inside a white card it read as a lilac wash. */}
                <div className="rounded-lg border border-input bg-card transition-colors focus-within:border-iris">
                  <textarea
                    ref={statementRef}
                    id="evidence-statement"
                    value={statement}
                    maxLength={EVIDENCE_STATEMENT_MAX}
                    onChange={(event) => setStatement(event.target.value)}
                    rows={4}
                    placeholder="What happened, with dates and what the photos or tracking show."
                    disabled={busy}
                    aria-describedby="evidence-statement-count"
                    className="block w-full resize-y bg-transparent px-cozy py-cozy text-body placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
                  />
                  <div className="flex items-center justify-between gap-cozy border-t px-cozy py-snug">
                    {/* Attach lives in the field's footer with the count: one compound
                        control rather than a field, then a heading, then a button. */}
                    <input
                      ref={fileInputRef}
                      id="evidence-files"
                      type="file"
                      accept={EVIDENCE_ACCEPT}
                      multiple
                      onChange={pickFiles}
                      disabled={busy || files.length >= EVIDENCE_FILES_MAX}
                      className="sr-only"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={busy || files.length >= EVIDENCE_FILES_MAX}
                      className="inline-flex items-center gap-tight rounded-md border border-transparent text-body font-medium text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:border-iris disabled:opacity-50"
                    >
                      <HugeiconsIcon icon={PaperclipIcon} className="size-4" aria-hidden />
                      Photos or video
                      <span className="tabular-nums text-muted-foreground">
                        {files.length}/{EVIDENCE_FILES_MAX}
                      </span>
                    </button>
                    <span
                      id="evidence-statement-count"
                      className={cn(
                        'text-meta tabular-nums',
                        remaining < 100 ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {statement.length.toLocaleString()}/{EVIDENCE_STATEMENT_MAX.toLocaleString()}
                    </span>
                  </div>
                </div>

                {files.length > 0 ? (
                  <ul className="mt-snug flex flex-wrap gap-snug">
                    {files.map((file, index) => (
                      <li
                        key={`${file.name}-${index}`}
                        className="inline-flex max-w-full items-center gap-tight rounded-md border bg-muted py-tight pl-snug pr-tight text-meta"
                      >
                        <span className="truncate">{file.name}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {(file.size / (1024 * 1024)).toFixed(1)} MB
                        </span>
                        <button
                          type="button"
                          onClick={() => removeFile(index)}
                          disabled={busy}
                          className="flex size-5 shrink-0 items-center justify-center rounded-sm border border-transparent text-muted-foreground transition-colors hover:bg-border hover:text-foreground focus:outline-none focus-visible:border-iris"
                          aria-label={`Remove ${file.name}`}
                        >
                          <HugeiconsIcon icon={XIcon} className="size-3.5" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              {error ? (
                <p role="alert" className="text-body text-destructive">
                  {error}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-cozy">
                {/* Finality is the surprising part of this form, so it sits beside the
                    button that makes it final, not in a heading above the field. */}
                <p className="inline-flex items-center gap-tight text-meta text-muted-foreground">
                  <HugeiconsIcon icon={LockIcon} className="size-3.5 shrink-0" aria-hidden />
                  Final once submitted
                </p>
                <div className="flex items-center gap-cozy">
                  {/* Says WHY the button is disabled. The minimum is a real server-side
                      rule, so a dead button alone would be misleading once a member has
                      typed two words. */}
                  {!busy && !longEnough && trimmed.length > 0 ? (
                    <span className="text-meta text-muted-foreground">
                      At least {EVIDENCE_STATEMENT_MIN} characters
                    </span>
                  ) : null}
                  <Button type="submit" size="xs" disabled={!ready} aria-busy={busy}>
                    {busy ? (
                      <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
                    ) : (
                      <HugeiconsIcon icon={SendHorizontalIcon} aria-hidden />
                    )}
                    {uploading ? 'Uploading…' : isPending ? 'Submitting…' : 'Submit'}
                  </Button>
                </div>
              </div>
            </form>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={openComposer}
              className="mt-cozy w-full sm:w-auto"
            >
              <HugeiconsIcon icon={PlusIcon} aria-hidden />
              Add your account
            </Button>
          )
        ) : (
          <p className="mt-cozy inline-flex items-center gap-tight text-meta text-muted-foreground">
            <HugeiconsIcon icon={LockIcon} className="size-3.5 shrink-0" aria-hidden />
            Closed
          </p>
        )}
      </section>

      {/* WHAT THEY ACTUALLY WROTE. People compose these while angry, and a confirmation
          that only asks "are you sure" without showing the words adds friction and
          catches nothing. */}
      <ConfirmDialog
        open={confirming}
        onOpenChange={(next) => {
          if (!next && !busy) setConfirming(false);
        }}
        title="File this statement?"
        description="It goes on the record for the other party and the staff member deciding this case, and cannot be edited or deleted."
        confirmLabel="File statement"
        pending={busy}
        onConfirm={() => void submit()}
      >
        <div className="max-h-48 overflow-y-auto rounded-lg bg-muted p-cozy">
          <p className="whitespace-pre-line break-words text-body">{trimmed}</p>
        </div>
        {files.length > 0 ? (
          <p className="text-meta text-muted-foreground">
            {files.length} attachment{files.length === 1 ? '' : 's'} filed with it.
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
