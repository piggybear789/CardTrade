'use client';

// components/scamReports/ScamReportForm.tsx
//
// The member's scam report form (scam-reports spec, Req 1–2): what happened, when, how
// they paid, the details the scammer used, and screenshots.
//
// THE DETAILS ARE THE POINT. The story is for staff to read, but only the payment
// details and handles are matched against other reports, so that section asks for
// them one at a time with a kind for each, rather than leaving them buried in prose.
// They are fingerprinted on the server and never stored as typed.
//
// PHOTOS UPLOAD AS THEY ARE PICKED, like the Trusted Seller form: straight to the
// private bucket, so "Send report" only carries their paths.
//
// Field errors sit beside their field. Anything else is a toast.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Add01Icon,
  Cancel01Icon,
  ImageAdd01Icon,
  LoaderCircleIcon,
  LockIcon,
} from '@hugeicons/core-free-icons';

import { submitScamReport } from '@/lib/actions/scamReports';
import { uploadScamReportEvidence } from '@/lib/storage/uploadScamReportEvidence';
import { SCAM_REPORT_EVIDENCE_ACCEPT } from '@/lib/storage/scamReportEvidenceShared';
import {
  REPORTABLE_IDENTIFIER_KINDS,
  SCAM_PAYMENT_METHODS,
  SCAM_REPORT_LIMITS,
  type ReportableIdentifierKind,
} from '@/domain/risk/scamReportVocabulary';
import { SOCIAL_PLATFORMS } from '@/domain/social/socialLinks';
import { Button } from '@/components/ui/button';
import { ChoiceTile } from '@/components/ui/choice-tile';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PendingLabel } from '@/components/ui/pending-label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type Tile =
  | { key: string; state: 'uploading'; preview: string }
  | { key: string; state: 'ready'; path: string; preview: string };

interface IdentifierRow {
  key: string;
  kind: ReportableIdentifierKind;
  platform: string;
  value: string;
}

const HANDLE_PLATFORMS = SOCIAL_PLATFORMS.filter((platform) => platform.kind === 'handle');

const VALUE_PLACEHOLDER: Record<ReportableIdentifierKind, string> = {
  PAYID_EMAIL: 'name@example.com',
  PAYID_PHONE: '0400 000 000',
  BANK_ACCOUNT: 'BSB 062-000, account 12345678',
  PAYPAL_EMAIL: 'name@example.com',
  CRYPTO_WALLET: 'Wallet address',
  PHONE: '0400 000 000',
  HANDLE: 'username, without the @',
};

const NARRATIVE_PLACEHOLDER = [
  'For example:',
  '• What you were buying or selling, and where you found them',
  '• What was agreed and what you paid',
  '• What happened after you paid',
].join('\n');

function newRow(): IdentifierRow {
  return { key: crypto.randomUUID(), kind: 'PAYID_EMAIL', platform: 'instagram', value: '' };
}

/** `YYYY-MM` for this month, in local time, as the month picker's ceiling. */
function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-body text-destructive">
      {message}
    </p>
  );
}

export interface ScamReportFormProps {
  /** The reporter's own currency, used for the optional amount. Lower-case ISO code. */
  currency: string;
}

export function ScamReportForm({ currency }: ScamReportFormProps) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [narrative, setNarrative] = useState('');
  const [month, setMonth] = useState('');
  const [method, setMethod] = useState('');
  const [amount, setAmount] = useState('');
  const [rows, setRows] = useState<IdentifierRow[]>(() => [newRow()]);
  const [scammerName, setScammerName] = useState('');
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [declared, setDeclared] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [maxMonth] = useState(thisMonth);

  const objectUrls = useRef(new Set<string>());
  useEffect(() => {
    const urls = objectUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const uploading = tiles.some((tile) => tile.state === 'uploading');
  const room = SCAM_REPORT_LIMITS.evidenceMax - tiles.length;

  function clearError(field: string) {
    setErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function updateRow(key: string, patch: Partial<IdentifierRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    const index = rows.findIndex((row) => row.key === key);
    clearError(`identifiers.${index}`);
    clearError('identifiers');
  }

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).slice(0, Math.max(room, 0));
    if (files.length > picked.length) {
      toast.error(`You can add up to ${SCAM_REPORT_LIMITS.evidenceMax} photos.`);
    }
    clearError('evidence');

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

  function reset() {
    setNarrative('');
    setMonth('');
    setMethod('');
    setAmount('');
    setRows([newRow()]);
    setScammerName('');
    setTiles([]);
    setDeclared(false);
    setErrors({});
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploading) return;
    setErrors({});
    setSending(true);
    const result = await submitScamReport({
      narrative,
      occurredMonth: month,
      paymentMethod: method,
      amount,
      currency,
      identifiers: rows.map((row) => ({
        kind: row.kind,
        value: row.value,
        platform: row.kind === 'HANDLE' ? row.platform : null,
      })),
      scammerName,
      evidencePaths: tiles.flatMap((tile) => (tile.state === 'ready' ? [tile.path] : [])),
      declared,
    });
    setSending(false);

    if (result.ok) {
      toast.success('Report sent. Thanks for helping keep other collectors safe.');
      reset();
      router.refresh();
      return;
    }
    if (result.field) {
      // Identifier errors arrive indexed over the rows that had a value, and blank rows
      // are skipped on the server, so map the index back onto the rows as drawn.
      const match = /^identifiers\.(\d+)$/.exec(result.field);
      if (match) {
        const filled = rows.filter((row) => row.value.trim());
        const row = filled[Number(match[1])];
        const drawnIndex = row ? rows.indexOf(row) : -1;
        setErrors({ [drawnIndex >= 0 ? `identifiers.${drawnIndex}` : 'identifiers']: result.message });
      } else {
        setErrors({ [result.field]: result.message });
      }
      return;
    }
    toast.error(result.message);
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-group">
      {/* WHAT HAPPENED */}
      <section className="space-y-group rounded-xl border border-border bg-card p-group md:p-section" aria-labelledby="scam-what">
        <div className="flex flex-wrap items-baseline justify-between gap-x-cozy">
          <h2 id="scam-what" className="text-lead font-semibold text-foreground">
            What happened
          </h2>
          <span className="inline-flex items-center gap-tight text-meta text-muted-foreground">
            <HugeiconsIcon icon={LockIcon} className="size-3.5" aria-hidden />
            Only our team sees this
          </span>
        </div>

        <div className="space-y-tight">
          <Label htmlFor="scam-narrative">Tell us what happened</Label>
          <Textarea
            id="scam-narrative"
            value={narrative}
            onChange={(event) => {
              setNarrative(event.target.value);
              clearError('narrative');
            }}
            placeholder={NARRATIVE_PLACEHOLDER}
            maxLength={SCAM_REPORT_LIMITS.narrativeMax}
            rows={8}
            aria-invalid={errors.narrative ? true : undefined}
            aria-describedby={errors.narrative ? 'scam-narrative-error' : 'scam-narrative-count'}
            className="leading-relaxed"
          />
          <div className="flex items-start justify-between gap-cozy">
            <FieldError id="scam-narrative-error" message={errors.narrative} />
            <span id="scam-narrative-count" className="ml-auto shrink-0 text-meta tabular-nums text-muted-foreground">
              {narrative.length.toLocaleString('en-AU')} / {SCAM_REPORT_LIMITS.narrativeMax.toLocaleString('en-AU')}
            </span>
          </div>
        </div>

        <div className="grid gap-group sm:grid-cols-2">
          <div className="space-y-tight">
            <Label htmlFor="scam-month">Roughly when</Label>
            <Input
              id="scam-month"
              type="month"
              value={month}
              max={maxMonth}
              onChange={(event) => {
                setMonth(event.target.value);
                clearError('occurredMonth');
              }}
              aria-invalid={errors.occurredMonth ? true : undefined}
              aria-describedby={errors.occurredMonth ? 'scam-month-error' : undefined}
            />
            <FieldError id="scam-month-error" message={errors.occurredMonth} />
          </div>
          <div className="space-y-tight">
            <Label htmlFor="scam-amount">
              How much you lost <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <div className="flex items-center gap-snug">
              <Input
                id="scam-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  clearError('amount');
                }}
                placeholder="250"
                aria-invalid={errors.amount ? true : undefined}
                aria-describedby={errors.amount ? 'scam-amount-error' : undefined}
              />
              <span className="shrink-0 text-body text-muted-foreground">{currency.toUpperCase()}</span>
            </div>
            <FieldError id="scam-amount-error" message={errors.amount} />
          </div>
        </div>

        <fieldset className="space-y-tight">
          <legend className="text-body font-medium text-foreground">How you paid</legend>
          <div
            className="grid grid-cols-2 gap-snug sm:grid-cols-4"
            aria-describedby={errors.paymentMethod ? 'scam-method-error' : undefined}
          >
            {SCAM_PAYMENT_METHODS.map((option) => (
              <ChoiceTile
                key={option.value}
                id={`scam-method-${option.value}`}
                name="scam-payment-method"
                type="radio"
                checked={method === option.value}
                onChange={() => {
                  setMethod(option.value);
                  clearError('paymentMethod');
                }}
                label={option.label}
                invalid={Boolean(errors.paymentMethod)}
              />
            ))}
          </div>
          <FieldError id="scam-method-error" message={errors.paymentMethod} />
        </fieldset>
      </section>

      {/* THE DETAILS THEY USED */}
      <section className="space-y-group rounded-xl border border-border bg-card p-group md:p-section" aria-labelledby="scam-details">
        <div className="space-y-tight">
          <h2 id="scam-details" className="text-lead font-semibold text-foreground">
            The details they used
          </h2>
          <p className="text-pretty text-body text-muted-foreground">
            The PayID, bank account, PayPal, phone number or handle they gave you. We turn these into
            a code that can only be matched, never read back, so we can spot the same person in other
            reports.
          </p>
        </div>

        <ul className="space-y-cozy">
          {rows.map((row, index) => {
            const errorKey = `identifiers.${index}`;
            const errorId = `scam-identifier-${row.key}-error`;
            return (
              <li key={row.key} className="space-y-tight">
                <div className="flex flex-col gap-snug sm:flex-row sm:items-start">
                  <div className="sm:w-56 sm:shrink-0">
                    <Label htmlFor={`scam-kind-${row.key}`} className="sr-only">
                      Detail {index + 1} type
                    </Label>
                    <Select
                      value={row.kind}
                      onValueChange={(value) => updateRow(row.key, { kind: value as ReportableIdentifierKind })}
                    >
                      <SelectTrigger id={`scam-kind-${row.key}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REPORTABLE_IDENTIFIER_KINDS.map((option) => (
                          <SelectItem key={option.kind} value={option.kind}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {row.kind === 'HANDLE' ? (
                    <div className="sm:w-40 sm:shrink-0">
                      <Label htmlFor={`scam-platform-${row.key}`} className="sr-only">
                        Detail {index + 1} platform
                      </Label>
                      <Select value={row.platform} onValueChange={(value) => updateRow(row.key, { platform: value })}>
                        <SelectTrigger id={`scam-platform-${row.key}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {HANDLE_PLATFORMS.map((platform) => (
                            <SelectItem key={platform.slug} value={platform.slug}>
                              {platform.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  <div className="flex min-w-0 flex-1 items-center gap-tight">
                    <Label htmlFor={`scam-value-${row.key}`} className="sr-only">
                      Detail {index + 1}
                    </Label>
                    <Input
                      id={`scam-value-${row.key}`}
                      value={row.value}
                      onChange={(event) => updateRow(row.key, { value: event.target.value })}
                      placeholder={VALUE_PLACEHOLDER[row.kind]}
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={errors[errorKey] ? true : undefined}
                      aria-describedby={errors[errorKey] ? errorId : undefined}
                    />
                    {rows.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setRows((current) => current.filter((other) => other.key !== row.key));
                          setErrors({});
                        }}
                        aria-label={`Remove detail ${index + 1}`}
                        className="shrink-0"
                      >
                        <HugeiconsIcon icon={Cancel01Icon} aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                </div>
                <FieldError id={errorId} message={errors[errorKey]} />
              </li>
            );
          })}
        </ul>
        <FieldError id="scam-identifiers-error" message={errors.identifiers} />

        {rows.length < SCAM_REPORT_LIMITS.identifiersMax ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setRows((current) => [...current, newRow()])}>
            <HugeiconsIcon icon={Add01Icon} aria-hidden />
            Add another detail
          </Button>
        ) : null}

        <div className="space-y-tight border-t border-border pt-group">
          <Label htmlFor="scam-name">
            The name they gave you <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="scam-name"
            value={scammerName}
            onChange={(event) => {
              setScammerName(event.target.value);
              clearError('scammerName');
            }}
            maxLength={SCAM_REPORT_LIMITS.scammerNameMax}
            autoComplete="off"
            aria-invalid={errors.scammerName ? true : undefined}
            aria-describedby={errors.scammerName ? 'scam-name-error' : 'scam-name-hint'}
          />
          {errors.scammerName ? (
            <FieldError id="scam-name-error" message={errors.scammerName} />
          ) : (
            <p id="scam-name-hint" className="text-meta text-muted-foreground">
              Scammers often use fake names, so we never match on this. It just helps us read the report.
            </p>
          )}
        </div>
      </section>

      {/* EVIDENCE */}
      <section className="space-y-snug rounded-xl border border-border bg-card p-group md:p-section" aria-labelledby="scam-evidence">
        <div className="space-y-tight">
          <h2 id="scam-evidence" className="text-lead font-semibold text-foreground">
            Screenshots
          </h2>
          <p className="text-pretty text-body text-muted-foreground">
            At least one. Your messages with them, the payment receipt, their profile. Cover anything
            you don&rsquo;t want us to see, like your own account number. Up to {SCAM_REPORT_LIMITS.evidenceMax}.
          </p>
        </div>

        <ul className="grid grid-cols-3 gap-snug sm:grid-cols-5" aria-describedby={errors.evidence ? 'scam-evidence-error' : undefined}>
          {tiles.map((tile, index) => (
            <li key={tile.key} className="relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
              {/* A local object URL: not a host the image optimizer knows. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={tile.preview} alt={`Screenshot ${index + 1}`} className="size-full object-cover" />
              {tile.state === 'uploading' ? (
                <span className="absolute inset-0 grid place-items-center bg-background/70" role="status">
                  <HugeiconsIcon icon={LoaderCircleIcon} className="size-5 animate-spin" aria-hidden />
                  <span className="sr-only">Uploading</span>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setTiles((current) => current.filter((other) => other.key !== tile.key))}
                  aria-label={`Remove screenshot ${index + 1}`}
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
                  'flex size-full flex-col items-center justify-center gap-tight rounded-lg border border-dashed text-meta text-muted-foreground transition-colors',
                  errors.evidence ? 'border-destructive' : 'border-input',
                  'hover:border-foreground/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <HugeiconsIcon icon={ImageAdd01Icon} className="size-5" aria-hidden />
                Add screenshots
              </button>
            </li>
          ) : null}
        </ul>
        <FieldError id="scam-evidence-error" message={errors.evidence} />
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
      </section>

      {/* DECLARATION AND SEND */}
      <div className="space-y-group rounded-xl border border-border bg-card p-group md:p-section">
        <div className="space-y-tight">
          <label htmlFor="scam-declared" className="flex cursor-pointer items-start gap-snug text-body text-foreground">
            <input
              id="scam-declared"
              type="checkbox"
              checked={declared}
              onChange={(event) => {
                setDeclared(event.target.checked);
                clearError('declared');
              }}
              aria-invalid={errors.declared ? true : undefined}
              aria-describedby={errors.declared ? 'scam-declared-error' : undefined}
              className="mt-1 size-4 shrink-0"
            />
            <span className="text-pretty">
              This is true to the best of my knowledge. I understand a false report can get my account
              closed.
            </span>
          </label>
          <FieldError id="scam-declared-error" message={errors.declared} />
        </div>

        <div className="flex flex-col gap-snug border-t border-border pt-group sm:flex-row sm:items-center sm:justify-between">
          <p className="text-pretty text-body text-muted-foreground">
            We don&rsquo;t publish reports or tell anyone who sent them.
          </p>
          <Button type="submit" disabled={sending || uploading} className="shrink-0">
            <PendingLabel pending={sending} pendingLabel="Sending…">
              {uploading ? 'Uploading screenshots…' : 'Send report'}
            </PendingLabel>
          </Button>
        </div>
      </div>
    </form>
  );
}
