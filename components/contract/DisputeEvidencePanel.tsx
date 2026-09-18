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
// READ AS A DOCKET, IN THIS ORDER: where the case stands, what was reported, what is on
// the record, your side, and only then the way out. That order is a correction. The
// panel used to open with the claim and offer to refund the buyer in full two lines
// later — the irreversible concession sat above the evidence you would need to read
// before conceding, and above the form that is the right move for almost everyone who
// opens this tab. `DisputeCaseHeader` now carries the status, so the composer being
// below the record costs nothing: the header says in words whether your side is missing.
//
// THREE DESIGN CHOICES WORTH DEFENDING:
//
//   1. BOTH PARTIES SEE EVERYTHING. A hidden-evidence model would mean deciding against
//      someone on material they never saw. The panel therefore shows the other side's
//      submissions in full, and says so before you write, so nobody submits under a
//      mistaken belief about who reads it. Said ONCE, immediately above the field —
//      the tab's own explainer already covers it, and three statements of one fact in
//      the opening four lines is where the status used to belong.
//   2. SUBMISSIONS ARE FINAL. There is no edit or delete. A statement is what a party
//      asserted at a moment in a dispute, and editable evidence is not evidence — the
//      same reasoning as the staff notes composer. Because it is final, filing goes
//      through a confirmation that shows the member what they wrote: this is the one
//      genuinely irreversible control in the room, and it used to be the only one that
//      fired on a single click while reversible ones asked twice.
//   3. THE DRAFT SURVIVES THE TAB. `ContractDetailList` swaps panels rather than hiding
//      them, so switching tabs unmounts this component, and on a phone the whole
//      inspector is a sheet. A member composing a careful account of being defrauded
//      lost it by tapping "History". Drafts are kept per case in `sessionStorage` and
//      cleared on a successful filing.
//
// NO CARD CHROME OF ITS OWN. This mounts inside a `ContractDetailRow` tabpanel, which
// already draws the bordered card and the "Dispute" tab header. An outer card and a
// second heading here would read as a panel inside a panel. `DisputeCaseHeader` is the
// single deliberate exception — see its own note.
//
// The panel owns no server action of its own beyond the evidence ones: raising or
// resolving a dispute stays with each room, because the two flows freeze and settle
// differently.

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  LoaderCircleIcon,
  LockIcon,
  PaperclipIcon,
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
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatContractDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ContractImageLightbox } from '@/components/contract/ContractImageLightbox';
import {
  DisputeCaseHeader,
  type DisputeCaseOutcome,
  type DisputeCaseStake,
} from '@/components/contract/DisputeCaseHeader';

export interface DisputeEvidencePanelProps {
  caseKind: DisputeCaseKind;
  caseRef: string;
  /** Every submission on this contract, oldest first. Both parties' included. */
  entries: DisputeEvidenceEntry[];
  /**
   * What is frozen while the case runs. REQUIRED, and supplied by the room rather than
   * derived here — see {@link DisputeCaseStake} for why the two flows cannot share one
   * sentence about it.
   */
  stake: DisputeCaseStake;
  /** The reason recorded when the dispute was raised, if any. */
  disputeReason?: string | null;
  /** Who raised it, for attributing the reason. `'you'` when the viewer did. */
  raisedByName?: string | null;
  /** Who it was raised against. `'you'` when that is the viewer. */
  againstName?: string | null;
  /** When it was raised, ISO. Drives the decision target on the cover sheet. */
  raisedAt?: string | null;
  /** The decision, once one exists. Shown in place of the decision target. */
  outcome?: DisputeCaseOutcome | null;
  /**
   * Role label per participant id — "Buyer", "Seller".
   *
   * Optional because it is only worth showing where the two sides hold DIFFERENT roles.
   * A Cash_Sale does; a 2-way Trade has two traders and labelling both "Trader" would
   * add a column that never varies.
   */
  roles?: Record<string, string>;
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
   *
   * Rendered LAST, under a rule. It was directly beneath the claim, which put the one
   * control that costs you the whole contract above everything you would read before
   * deciding to use it.
   */
  resolution?: ReactNode;
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
        <span className="px-2 text-center text-body leading-tight">
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
 * One party's submission.
 *
 * SIDED AND ROLE-LABELLED, because the reader's first question about a two-party record
 * is who said what and whether the other side answered. This was a flat chronological
 * stack in one style, which answers that question only by reading every byline.
 */
function EvidenceEntry({
  entry,
  role,
  photoIndexByPath,
  onOpenPhoto,
}: {
  entry: DisputeEvidenceEntry;
  role?: string;
  photoIndexByPath: Map<string, number>;
  onOpenPhoto: (index: number) => void;
}) {
  return (
    <li className="relative pl-group">
      {/* A MARKER, NOT A FRAME. The border rule in `app/globals.css` keeps containers
          neutral and reserves `--iris` for rings, markers and the shape of a chip.
          This is the shape of a filing in a two-party sequence. */}
      <span
        aria-hidden
        className={cn(
          'absolute bottom-0 left-0 top-1 w-0.5 rounded-full',
          entry.mine ? 'bg-iris' : 'bg-border',
        )}
      />
      <div className="flex flex-wrap items-baseline justify-between gap-x-cozy gap-y-tight">
        <p className="text-body">
          <span className="font-semibold">
            {entry.mine ? 'You' : entry.authorName}
          </span>
          {role ? (
            <span className="text-muted-foreground"> · {role}</span>
          ) : null}
        </p>
        <span className="text-meta tabular-nums text-muted-foreground">
          {formatContractDateTime(entry.createdAt) ?? entry.createdAt}
        </span>
      </div>
      <p className="mt-1.5 whitespace-pre-line break-words text-body">
        {entry.statement}
      </p>
      {entry.media.length > 0 ? (
        <div className="mt-cozy grid grid-cols-3 gap-snug sm:grid-cols-4">
          {entry.media.map((media) => {
            const index = photoIndexByPath.get(media.path);
            return (
              <MediaTile
                key={media.path}
                path={media.path}
                url={media.url}
                onOpen={index === undefined ? undefined : () => onOpenPhoto(index)}
              />
            );
          })}
        </div>
      ) : null}
    </li>
  );
}

export function DisputeEvidencePanel({
  caseKind,
  caseRef,
  entries,
  stake,
  disputeReason,
  raisedByName,
  againstName,
  raisedAt,
  outcome,
  roles,
  canSubmit = true,
  resolution,
}: DisputeEvidencePanelProps) {
  const viewerHasFiled = entries.some((entry) => entry.mine);

  const [statement, setStatement] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [draftReady, setDraftReady] = useState(false);
  // Expanded when the viewer has nothing on the record, collapsed once they do. A
  // return visitor's question is "has the other side answered", and a full-height empty
  // form is the wrong answer to it.
  const [composing, setComposing] = useState(!viewerHasFiled);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const busy = uploading || isPending;
  const trimmed = statement.trim();
  const longEnough = trimmed.length >= EVIDENCE_STATEMENT_MIN;
  const ready = longEnough && !busy;
  const remaining = EVIDENCE_STATEMENT_MAX - statement.length;
  const draftKey = `noditto:dispute-draft:${caseKind}:${caseRef}`;

  // ONE LIGHTBOX FOR THE WHOLE CASE, not one per entry. Mounting a dialog per
  // submission was a dialog per submission whether or not anything was open, and it
  // trapped browsing inside a single filing — an examiner comparing the photo the buyer
  // sent with the photo the seller sent had to close one gallery and open another.
  const { photoUrls, photoIndexByPath } = useMemo(() => {
    const urls: string[] = [];
    const byPath = new Map<string, number>();
    for (const entry of entries) {
      for (const media of entry.media) {
        if (media.url && !isVideoPath(media.path)) {
          byPath.set(media.path, urls.length);
          urls.push(media.url);
        }
      }
    }
    return { photoUrls: urls, photoIndexByPath: byPath };
  }, [entries]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Restore first, then save. `draftReady` gates the save so the mount pass cannot
  // write an empty string over the draft it is in the middle of reading.
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(draftKey);
      if (saved) setStatement(saved);
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

  function openComposer() {
    setComposing(true);
    // The composer is the last thing in the panel, so revealing it from a button at the
    // top of it leaves the field off screen on a phone.
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function submit() {
    setError(null);
    setInvalidField(null);

    // Bytes go browser -> Storage first; only the resulting paths reach the action, so a
    // 40 MB video never travels inside a Server Action body.
    let mediaPaths: string[] = [];
    if (files.length > 0) {
      setUploading(true);
      const uploaded = await uploadDisputeEvidence(files);
      setUploading(false);
      if (!uploaded.ok) {
        setConfirming(false);
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
        // SAY SO. This used to clear the field and do nothing else, so the one
        // irreversible act in the room ended with the member's words disappearing and
        // no confirmation that they had landed anywhere.
        toast.success('Your statement is on the record.');
        setStatement('');
        setFiles([]);
        setComposing(false);
        try {
          window.sessionStorage.removeItem(draftKey);
        } catch {
          // Nothing to clean up if storage is unavailable.
        }
      } else {
        setError(result.message);
        setInvalidField(result.field ?? null);
      }
    });
  }

  /** What the field's footer counter should say, or nothing when neither bound is near. */
  const counter = (() => {
    if (!longEnough) {
      const needed = EVIDENCE_STATEMENT_MIN - trimmed.length;
      return {
        text:
          trimmed.length === 0
            ? `${EVIDENCE_STATEMENT_MIN} characters minimum`
            : `${needed} more character${needed === 1 ? '' : 's'}`,
        urgent: false,
      };
    }
    // The ceiling only matters near it. Showing `0/4,000` from the first keystroke read
    // as a target to fill rather than a limit not to cross, and hid the minimum that is
    // the rule actually stopping the button from working.
    if (remaining <= 400) {
      return { text: `${remaining.toLocaleString()} characters left`, urgent: remaining < 100 };
    }
    return null;
  })();

  return (
    <div className="space-y-8">
      <DisputeCaseHeader
        stake={stake}
        raisedByName={raisedByName}
        againstName={againstName}
        raisedAt={raisedAt}
        outcome={outcome}
        viewerHasFiled={viewerHasFiled}
        canSubmit={canSubmit}
      />

      {/* The claim that opened the case. "What was reported" rather than "why this is in
          dispute": the second phrasing states the claim as the reason, which is the one
          thing it is not yet, and the accused party reads this line too. */}
      {disputeReason ? (
        <section aria-labelledby="dispute-claim-heading">
          <h3
            id="dispute-claim-heading"
            className="flex items-center gap-snug text-meta font-semibold uppercase tracking-wide text-destructive"
          >
            <HugeiconsIcon icon={ShieldAlertIcon} className="size-4 shrink-0" aria-hidden />
            What was reported
          </h3>
          <p className="mt-snug whitespace-pre-line break-words text-pretty text-lead font-medium">
            {disputeReason}
          </p>
        </section>
      ) : null}

      {/* The record. Both sides, chronological. */}
      <section aria-labelledby="evidence-heading">
        <h3 id="evidence-heading" className="text-body font-semibold">
          On the record
          {entries.length > 0 ? (
            <span className="ml-1.5 font-normal text-muted-foreground">
              ({entries.length})
            </span>
          ) : null}
        </h3>

        {entries.length === 0 ? (
          <p className="mt-snug text-pretty text-body text-muted-foreground">
            Nothing filed yet. The staff member deciding this case reads only what is
            written here, so a statement from each side is what moves it along.
          </p>
        ) : (
          <ul className="mt-group space-y-group">
            {entries.map((entry) => (
              <EvidenceEntry
                key={entry.id}
                entry={entry}
                role={roles?.[entry.authorId]}
                photoIndexByPath={photoIndexByPath}
                onOpenPhoto={setLightboxIndex}
              />
            ))}
          </ul>
        )}
      </section>

      <ContractImageLightbox
        images={photoUrls}
        openIndex={lightboxIndex}
        onOpenChange={setLightboxIndex}
        label="Dispute evidence"
      />

      {/* The composer. Absent once the case is decided — the record stays, the form
          goes, because filing into a closed decision is not a thing that should appear
          to work. */}
      {canSubmit ? (
        <section aria-labelledby="submit-heading">
          <h3 id="submit-heading" className="text-body font-semibold">
            Your side of it
          </h3>
          {/* BOTH FACTS, ONE LINE, STATED HERE. Who reads it and that it cannot be taken
              back are the two things that change what a person types, so they belong at
              the field rather than spread over three paragraphs at the top of the tab. */}
          <p className="mt-1 flex items-start gap-tight text-pretty text-body text-muted-foreground">
            <HugeiconsIcon icon={LockIcon} className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              The other party and the staff member deciding this case will read it. It
              cannot be edited or deleted once filed.
            </span>
          </p>

          {!composing ? (
            <Button
              type="button"
              variant="outline"
              className="mt-group"
              onClick={openComposer}
            >
              <HugeiconsIcon icon={SendHorizontalIcon} className="size-4" aria-hidden />
              Add another statement
            </Button>
          ) : (
            <form
              className="mt-group space-y-cozy"
              onSubmit={(event) => {
                event.preventDefault();
                // A confirmation rather than a submit. Final, permanent and read by the
                // person you are in dispute with is the shape that earns a second look,
                // and it lets the member re-read what they wrote in anger.
                if (ready) setConfirming(true);
              }}
            >
              <div>
                <label
                  htmlFor="evidence-statement"
                  className="mb-1.5 block text-body font-medium"
                >
                  What happened
                </label>
                {/* One object: the field, the control that adds photos to it, and the
                    count of what is left. The attach button used to be a separate
                    block with its own label and its own counter, which was three rows
                    of chrome for an optional control. */}
                <div
                  className={cn(
                    'rounded-xl border bg-background transition-colors focus-within:border-iris',
                    invalidField === 'statement' ? 'border-destructive' : 'border-input',
                  )}
                >
                  <textarea
                    ref={textareaRef}
                    id="evidence-statement"
                    value={statement}
                    maxLength={EVIDENCE_STATEMENT_MAX}
                    onChange={(event) => setStatement(event.target.value)}
                    rows={5}
                    placeholder="What you sent or received, its condition, the dates that matter, and anything the tracking or photos show."
                    disabled={busy}
                    aria-invalid={invalidField === 'statement' || undefined}
                    aria-describedby="evidence-statement-count"
                    // Compound field, but the same type as every other editable
                    // control: `text-body`. The 16px floor it used to carry relied on
                    // the `pointer-fine:` variant, which no longer exists — see the
                    // note in `components/ui/input.tsx`.
                    className="block w-full resize-y bg-transparent px-3.5 py-cozy text-body placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
                  />
                  <div className="flex items-center justify-between gap-cozy border-t px-snug py-1.5">
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
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={busy || files.length >= EVIDENCE_FILES_MAX}
                    >
                      <HugeiconsIcon icon={PaperclipIcon} className="size-4" aria-hidden />
                      Add photos or video
                      {files.length > 0 ? (
                        <span className="tabular-nums text-muted-foreground">
                          {files.length}/{EVIDENCE_FILES_MAX}
                        </span>
                      ) : null}
                    </Button>
                    <span
                      id="evidence-statement-count"
                      className={cn(
                        'shrink-0 pr-1.5 text-meta tabular-nums',
                        counter?.urgent ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {counter?.text ?? ''}
                    </span>
                  </div>
                </div>
              </div>

              {files.length > 0 ? (
                <ul className="flex flex-wrap gap-snug">
                  {files.map((file, index) => (
                    <li
                      key={`${file.name}-${index}`}
                      className="inline-flex max-w-full items-center gap-tight rounded-lg border bg-muted py-1 pl-snug pr-1 text-body"
                    >
                      <span className="truncate">{file.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {(file.size / (1024 * 1024)).toFixed(1)} MB
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        disabled={busy}
                        className="flex size-5 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:bg-border hover:text-foreground focus:outline-none focus-visible:border-iris"
                        aria-label={`Remove ${file.name}`}
                      >
                        <HugeiconsIcon icon={XIcon} className="size-3.5" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {error ? (
                <p role="alert" className="text-body text-destructive">
                  {error}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-cozy pt-snug">
                <Button type="submit" disabled={!ready} aria-busy={busy}>
                  {busy ? (
                    <HugeiconsIcon icon={LoaderCircleIcon} className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <HugeiconsIcon icon={SendHorizontalIcon} className="size-4" aria-hidden />
                  )}
                  {uploading ? 'Uploading…' : isPending ? 'Filing…' : 'Review and file'}
                </Button>
                {/* The safety net, said out loud. A draft that is silently kept is a
                    draft nobody trusts, so a member retypes rather than switching tabs
                    to check a tracking number they need in order to write accurately. */}
                {!busy && trimmed.length > 0 ? (
                  <p className="text-meta text-muted-foreground">
                    Draft kept on this device until you file it.
                  </p>
                ) : null}
              </div>
            </form>
          )}
        </section>
      ) : (
        <p className="border-t pt-5 text-body text-muted-foreground">
          The record is closed. Nothing further can be added to this case.
        </p>
      )}

      {/* THE WAY OUT, LAST AND UNDER A RULE. */}
      {resolution ? <div className="border-t pt-group">{resolution}</div> : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={(next) => {
          if (!next) setConfirming(false);
        }}
        title="File this statement?"
        description="It goes on the record for the other party and for the staff member deciding this case. You cannot edit or delete it afterwards, though you can file another statement later."
        confirmLabel="File statement"
        pending={busy}
        onConfirm={() => void submit()}
      >
        {/* WHAT THEY ACTUALLY WROTE. People compose these while angry, and a
            confirmation that only asks "are you sure" without showing the words is a
            step that adds friction and catches nothing. */}
        <div className="max-h-48 overflow-y-auto rounded-lg bg-muted p-cozy">
          <p className="whitespace-pre-line break-words text-body">{trimmed}</p>
        </div>
        {files.length > 0 ? (
          <p className="text-body text-muted-foreground">
            {files.length} attachment{files.length === 1 ? '' : 's'} will be filed with
            it.
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
