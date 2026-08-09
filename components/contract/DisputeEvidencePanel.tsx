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
// The panel owns no server action of its own beyond the evidence ones: raising or
// resolving a dispute stays with each room, because the two flows freeze and settle
// differently.

import { useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import {
  FileVideo,
  ImageIcon,
  Loader2,
  Paperclip,
  Send,
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
}

/** One attachment, rendered as a thumbnail or a video frame. */
function MediaTile({ path, url }: { path: string; url: string | null }) {
  const video = isVideoPath(path);

  if (!url) {
    return (
      <div className="grid aspect-square place-items-center rounded-md border border-dashed bg-muted/30 text-muted-foreground">
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
        className="aspect-square w-full rounded-md border bg-black object-contain"
      />
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block aspect-square overflow-hidden rounded-md border focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        'rounded-lg border p-3',
        entry.mine ? 'border-gold/40 bg-gold/5' : 'bg-card',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">
          {entry.mine ? 'Your statement' : entry.authorName}
        </p>
        <span className="text-[11px] tabular-nums text-muted-foreground">
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
}: DisputeEvidencePanelProps) {
  const [statement, setStatement] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const busy = uploading || isPending;
  const trimmed = statement.trim();
  const ready = trimmed.length >= EVIDENCE_STATEMENT_MIN && !busy;

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
    <div className="space-y-5">
      {/* The claim that opened the case. Shown first because everything below is a
          response to it. */}
      {disputeReason ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-4 shrink-0 text-destructive" aria-hidden />
            <p className="text-sm font-semibold">Why this is in dispute</p>
          </div>
          <p className="mt-1.5 whitespace-pre-line break-words text-sm leading-relaxed">
            {disputeReason}
          </p>
          {raisedByName ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Raised by {raisedByName}. This is a claim, not a finding.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* The record. Both sides, chronological. */}
      <section aria-labelledby="evidence-heading" className="space-y-3">
        <div>
          <h3 id="evidence-heading" className="text-sm font-semibold">
            Evidence on file
            {entries.length > 0 ? (
              <span className="ml-1.5 font-normal text-muted-foreground">
                ({entries.length})
              </span>
            ) : null}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Both of you can see everything here, and so can the staff member deciding it.
          </p>
        </div>

        {entries.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            Nothing has been submitted yet. Whoever explains what happened first gives
            staff something to work from.
          </p>
        ) : (
          <ul className="space-y-3">
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
        <section aria-labelledby="submit-heading" className="space-y-3 border-t pt-4">
          <div>
            <h3 id="submit-heading" className="text-sm font-semibold">
              Add your account
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Submissions are final and cannot be edited or removed. Add another if you
              have more to say.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="evidence-statement">What happened, in your words</Label>
            <Textarea
              id="evidence-statement"
              value={statement}
              onChange={(event) => setStatement(event.target.value)}
              maxLength={EVIDENCE_STATEMENT_MAX}
              rows={5}
              placeholder="What you sent or received, what condition it was in, what dates matter, and anything the tracking or photos show."
              disabled={busy}
              aria-describedby="evidence-statement-count"
            />
            <p
              id="evidence-statement-count"
              className="text-right text-[11px] tabular-nums text-muted-foreground"
            >
              {trimmed.length}/{EVIDENCE_STATEMENT_MAX}
            </p>
          </div>

          {/* Attachments. Photos and video of the goods, packaging, or tracking. */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="evidence-files">
                Photos or video{' '}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <span className="text-[11px] text-muted-foreground">
                {files.length}/{EVIDENCE_FILES_MAX}
              </span>
            </div>
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
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || files.length >= EVIDENCE_FILES_MAX}
            >
              <Paperclip className="size-3.5" aria-hidden />
              Attach files
            </Button>

            {files.length > 0 ? (
              <ul className="space-y-1.5">
                {files.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="flex items-center gap-2 rounded-md border bg-muted/20 px-2.5 py-1.5 text-xs"
                  >
                    {file.type.startsWith('video/') ? (
                      <FileVideo className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    ) : (
                      <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {(file.size / (1024 * 1024)).toFixed(1)} MB
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      disabled={busy}
                      className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Remove ${file.name}`}
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="button" onClick={submit} disabled={!ready} aria-busy={busy}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Send className="size-4" aria-hidden />
            )}
            {uploading ? 'Uploading…' : isPending ? 'Submitting…' : 'Submit evidence'}
          </Button>
        </section>
      ) : (
        <p className="border-t pt-4 text-sm text-muted-foreground">
          This case has been decided, so no further evidence can be added.
        </p>
      )}
    </div>
  );
}
