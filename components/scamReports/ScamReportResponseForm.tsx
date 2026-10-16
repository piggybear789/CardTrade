'use client';

// components/scamReports/ScamReportResponseForm.tsx
//
// A matched member's answer to a scam report staff told them about (scam-reports spec,
// Req 8): one free-text box and optional photos, sent once.
//
// Photos upload as they are picked, to the same private bucket as report evidence but
// under the RESPONDER's own id, so a response can never attach a reporter's files.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, ImageAdd01Icon, LoaderCircleIcon, LockIcon } from '@hugeicons/core-free-icons';

import { respondToScamReportMatch } from '@/lib/actions/scamReports';
import { uploadScamReportEvidence } from '@/lib/storage/uploadScamReportEvidence';
import { SCAM_REPORT_EVIDENCE_ACCEPT } from '@/lib/storage/scamReportEvidenceShared';
import { SCAM_REPORT_LIMITS } from '@/domain/risk/scamReportVocabulary';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PendingLabel } from '@/components/ui/pending-label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

type Tile =
  | { key: string; state: 'uploading'; preview: string }
  | { key: string; state: 'ready'; path: string; preview: string };

const PLACEHOLDER = [
  'For example:',
  '• Whether you recognise the deal, and what you remember of it',
  '• If someone may be using your details or pretending to be you',
  '• Anything that shows what really happened',
].join('\n');

export function ScamReportResponseForm({ reportId }: { reportId: string }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const objectUrls = useRef(new Set<string>());
  useEffect(() => {
    const urls = objectUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const uploading = tiles.some((tile) => tile.state === 'uploading');
  const room = SCAM_REPORT_LIMITS.evidenceMax - tiles.length;

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).slice(0, Math.max(room, 0));
    if (files.length > picked.length) {
      toast.error(`You can add up to ${SCAM_REPORT_LIMITS.evidenceMax} photos.`);
    }
    for (const file of picked) {
      const key = `${file.name}-${file.size}-${crypto.randomUUID()}`;
      const preview = URL.createObjectURL(file);
      objectUrls.current.add(preview);
      setTiles((current) => [...current, { key, state: 'uploading', preview }]);
      const result = await uploadScamReportEvidence(file);
      if (result.ok) {
        setTiles((current) =>
          current.map((tile) => (tile.key === key ? { key, state: 'ready', path: result.path, preview } : tile)),
        );
      } else {
        toast.error(result.message);
        setTiles((current) => current.filter((tile) => tile.key !== key));
      }
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploading) return;
    setFieldError(null);
    setSending(true);
    const result = await respondToScamReportMatch(
      reportId,
      text,
      tiles.flatMap((tile) => (tile.state === 'ready' ? [tile.path] : [])),
    );
    setSending(false);
    if (result.ok) {
      toast.success('Thanks. We’ve got your response.');
      router.refresh();
      return;
    }
    if (result.field === 'response') {
      setFieldError(result.message);
      return;
    }
    toast.error(result.message);
  }

  return (
    <form onSubmit={submit} noValidate className="rounded-xl border border-border bg-card p-group md:p-section">
      <div className="space-y-tight">
        <div className="flex flex-wrap items-baseline justify-between gap-x-cozy">
          <Label htmlFor="scam-response" className="text-lead font-semibold">
            Your side
          </Label>
          <span className="inline-flex items-center gap-tight text-meta text-muted-foreground">
            <HugeiconsIcon icon={LockIcon} className="size-3.5" aria-hidden />
            Only our team sees this
          </span>
        </div>
        <Textarea
          id="scam-response"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={PLACEHOLDER}
          maxLength={SCAM_REPORT_LIMITS.narrativeMax}
          rows={8}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? 'scam-response-error' : 'scam-response-count'}
          className="leading-relaxed"
        />
        <div className="flex items-start justify-between gap-cozy">
          {fieldError ? (
            <p id="scam-response-error" role="alert" className="text-body text-destructive">
              {fieldError}
            </p>
          ) : (
            <span />
          )}
          <span id="scam-response-count" className="shrink-0 text-meta tabular-nums text-muted-foreground">
            {text.length.toLocaleString('en-AU')} / {SCAM_REPORT_LIMITS.narrativeMax.toLocaleString('en-AU')}
          </span>
        </div>
      </div>

      <div className="mt-section space-y-snug">
        <div>
          <p className="text-body font-semibold text-foreground">Photos</p>
          <p className="text-pretty text-body text-muted-foreground">
            Optional. Screenshots or receipts that back up what you&rsquo;ve told us. Up to{' '}
            {SCAM_REPORT_LIMITS.evidenceMax}.
          </p>
        </div>
        <ul className="grid grid-cols-3 gap-snug sm:grid-cols-5">
          {tiles.map((tile, index) => (
            <li key={tile.key} className="relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
              {/* A local object URL: not a host the image optimizer knows. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={tile.preview} alt={`Photo ${index + 1}`} className="size-full object-cover" />
              {tile.state === 'uploading' ? (
                <span className="absolute inset-0 grid place-items-center bg-background/70" role="status">
                  <HugeiconsIcon icon={LoaderCircleIcon} className="size-5 animate-spin" aria-hidden />
                  <span className="sr-only">Uploading</span>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setTiles((current) => current.filter((other) => other.key !== tile.key))}
                  aria-label={`Remove photo ${index + 1}`}
                  className="absolute right-1 top-1 grid size-7 place-items-center rounded-full bg-background/90 text-foreground shadow-sm transition-colors hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
          {room > 0 ? (
            <li className="aspect-square">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className={cn(
                  'flex size-full flex-col items-center justify-center gap-tight rounded-lg border border-dashed border-input text-meta text-muted-foreground transition-colors',
                  'hover:border-foreground/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <HugeiconsIcon icon={ImageAdd01Icon} className="size-5" aria-hidden />
                Add photos
              </button>
            </li>
          ) : null}
        </ul>
        <input
          ref={fileInput}
          type="file"
          accept={SCAM_REPORT_EVIDENCE_ACCEPT}
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            void addFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      <div className="mt-section flex flex-col gap-snug border-t border-border pt-group sm:flex-row sm:items-center sm:justify-between">
        <p className="text-pretty text-body text-muted-foreground">You can send this once.</p>
        <Button type="submit" disabled={sending || uploading} className="shrink-0">
          <PendingLabel pending={sending} pendingLabel="Sending…">
            {uploading ? 'Uploading photos…' : 'Send response'}
          </PendingLabel>
        </Button>
      </div>
    </form>
  );
}
