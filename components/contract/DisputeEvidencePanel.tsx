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
// NO CARD CHROME OF ITS OWN. This mounts inside a `ContractDetailRow` tabpanel, which
// already draws the bordered card and the "Dispute" tab header. An outer card and a
// second heading here would read as a panel inside a panel.
//
// The panel owns no server action of its own beyond the evidence ones: raising or
// resolving a dispute stays with each room, because the two flows freeze and settle
// differently.

import { useRef, useState, useTransition, type ReactNode } from 'react';
import Image from 'next/image';
import {
  Eye,
  FileText,
  Loader2,
  Lock,
  Paperclip,
  SendHorizontal,
  ShieldAlert,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

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
import { formatContractDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface DisputeEvidencePanelProps {
  caseKind: DisputeCaseKind;
  caseRef: string;
  /** Every submission on this contract, oldest first. Both parties' included. */
  entries: DisputeEvidenceEntry[];
  /** The reason recorded when the dispute was raised, if any. */
  disputeReason?: string | null;
  /** Who raised it, for attributing the reason. */
  raisedByName?: string | null;
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

/** One attachment, rendered as a thumbnail or a video frame. */
function MediaTile({ path, url }: { path: string; url: string | null }) {
  const video = isVideoPath(path);

  if (!url) {
    return (
      <div className="grid aspect-square place-items-center rounded-lg border border-dashed bg-muted/40 text-muted-foreground">
        <span className="px-2 text-center text-[10px] leading-tight">
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
        className="aspect-square w-full rounded-lg border bg-black object-contain"
      />
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block aspect-square overflow-hidden rounded-lg border focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
    </a>
  );
}

/** One party's submission. */
function EvidenceEntry({ entry }: { entry: DisputeEvidenceEntry }) {
  return (
    <li
      className={cn(
        'rounded-xl border px-4 py-3',
        entry.mine ? 'border-gold/40 bg-gold/5' : 'bg-card',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">
          {entry.mine ? 'Your statement' : entry.authorName}
        </p>
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatContractDateTime(entry.createdAt) ?? entry.createdAt}
        </span>
      </div>
      <p className="mt-1.5 whitespace-pre-line break-words text-sm leading-relaxed">
        {entry.statement}
      </p>
      {entry.media.length > 0 ? (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {entry.media.map((media) => (
            <MediaTile key={media.path} path={media.path} url={media.url} />
          ))}
        </div>
      ) : null}
    </li>
  );
}

export function DisputeEvidencePanel({
  caseKind,
  caseRef,
  entries,
  disputeReason,
  raisedByName,
  canSubmit = true,
  resolution,
}: DisputeEvidencePanelProps) {
  const [statement, setStatement] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const busy = uploading || isPending;
  const trimmed = statement.trim();
  const longEnough = trimmed.length >= EVIDENCE_STATEMENT_MIN;
  const ready = longEnough && !busy;
  const remaining = EVIDENCE_STATEMENT_MAX - statement.length;

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
      if (result.ok) {
        toast.success('Evidence submitted. Staff and the other party can now see it.');
        setStatement('');
        setFiles([]);
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div className="space-y-8">
      {/* The claim that opened the case. Shown first because everything below is a
          response to it. */}
      {disputeReason ? (
        <div className="rounded-xl border border-destructive/25 bg-destructive/[0.06] p-4">
          <div className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="size-4 shrink-0" aria-hidden />
            <h3 className="text-xs font-semibold uppercase tracking-wide">
              Why this is in dispute
            </h3>
          </div>
          <p className="mt-2 whitespace-pre-line break-words text-pretty text-base font-medium leading-relaxed">
            {disputeReason}
          </p>
          {raisedByName ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Raised by {raisedByName}. This is a claim, not a finding.
            </p>
          ) : null}
          {resolution ? (
            <div className="mt-4 border-t border-destructive/15 pt-4">
              {resolution}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* The record. Both sides, chronological. */}
      <section aria-labelledby="evidence-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 id="evidence-heading" className="text-sm font-semibold">
            Evidence on file
            {entries.length > 0 ? (
              <span className="ml-1.5 font-normal text-muted-foreground">
                ({entries.length})
              </span>
            ) : null}
          </h3>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Eye className="size-3.5 shrink-0" aria-hidden />
            Visible to both parties &amp; staff
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything submitted here is shared with the other party and the staff member
          deciding the case.
        </p>

        {entries.length === 0 ? (
          <div className="mt-4 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/40 px-6 py-8 text-center">
            <div className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <FileText className="size-4" aria-hidden />
            </div>
            <p className="text-sm font-medium">Nothing submitted yet</p>
            <p className="max-w-sm text-pretty text-xs text-muted-foreground">
              Explain with details to help arbitration.
            </p>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {entries.map((entry) => (
              <EvidenceEntry key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </section>

      {/* The composer. Absent once the case is decided — the record stays, the form
          goes, because filing into a closed decision is not a thing that should appear
          to work. */}
      {canSubmit ? (
        <section aria-labelledby="submit-heading">
          <h3 id="submit-heading" className="text-sm font-semibold">
            Add your account
          </h3>
          {/* Stated BEFORE the field, not after submitting. Finality is the surprising
              part of this form and the header note explains why it is deliberate. */}
          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5 shrink-0" aria-hidden />
            Submissions are final. Add another entry if you have more to say.
          </p>
          <form
            className="mt-4 space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (ready) void submit();
            }}
          >
            <div>
              <label
                htmlFor="evidence-statement"
                className="mb-1.5 block text-sm font-medium"
              >
                What happened, in your words
              </label>
              {/* The count lives inside the field's own border rather than floating
                  under it, so the control reads as one object. */}
              <div className="rounded-xl border border-input bg-background transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
                <textarea
                  id="evidence-statement"
                  value={statement}
                  maxLength={EVIDENCE_STATEMENT_MAX}
                  onChange={(event) => setStatement(event.target.value)}
                  rows={4}
                  placeholder="What you sent or received, its condition, the dates that matter, and anything the tracking or photos show."
                  disabled={busy}
                  aria-describedby="evidence-statement-count"
                  className="block w-full resize-y bg-transparent px-3.5 py-3 text-sm placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
                />
                <div className="flex items-center justify-end border-t px-3.5 py-2">
                  <span
                    id="evidence-statement-count"
                    className={cn(
                      'text-xs tabular-nums',
                      remaining < 100 ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {statement.length.toLocaleString()}/
                    {EVIDENCE_STATEMENT_MAX.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Attachments. Photos and video of the goods, packaging, or tracking. */}
            <div>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <label htmlFor="evidence-files" className="text-sm font-medium">
                  Photos or video{' '}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {files.length}/{EVIDENCE_FILES_MAX}
                </span>
              </div>

              {files.length > 0 ? (
                <ul className="mb-3 flex flex-wrap gap-2">
                  {files.map((file, index) => (
                    <li
                      key={`${file.name}-${index}`}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-muted/60 py-1 pl-2.5 pr-1 text-xs"
                    >
                      <span className="truncate">{file.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {(file.size / (1024 * 1024)).toFixed(1)} MB
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        disabled={busy}
                        className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-border hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Remove ${file.name}`}
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

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
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy || files.length >= EVIDENCE_FILES_MAX}
              >
                <Paperclip className="size-4" aria-hidden />
                Attach files
              </Button>
            </div>

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-3 border-t pt-5">
              <Button type="submit" disabled={!ready} aria-busy={busy}>
                {busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <SendHorizontal className="size-4" aria-hidden />
                )}
                {uploading ? 'Uploading…' : isPending ? 'Submitting…' : 'Submit evidence'}
              </Button>
              {/* Says WHY the button is disabled. The minimum is a real server-side
                  rule, so "add your account" alone would be misleading once a member
                  has typed two words and the button is still dead. */}
              {!busy && !longEnough ? (
                <p className="text-xs text-muted-foreground">
                  {trimmed.length === 0
                    ? 'Add your account before submitting.'
                    : `At least ${EVIDENCE_STATEMENT_MIN} characters.`}
                </p>
              ) : null}
            </div>
          </form>
        </section>
      ) : (
        <p className="border-t pt-5 text-sm text-muted-foreground">
          This case has been decided, so no further evidence can be added.
        </p>
      )}
    </div>
  );
}
