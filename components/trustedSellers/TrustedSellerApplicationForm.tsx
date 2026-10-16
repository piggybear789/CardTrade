'use client';

// components/trustedSellers/TrustedSellerApplicationForm.tsx
//
// The Trusted Seller application (0153): one free-text box and optional photos.
//
// ONE OPEN QUESTION, ON PURPOSE. The review is done by hand, so the form does not guess
// which platforms or facts matter for every seller. The placeholder lists what helps,
// and the applicant writes it however they like.
//
// PHOTOS UPLOAD AS THEY ARE PICKED, straight to the private bucket, so "Send" only
// carries their paths. Each tile shows its own progress and can be removed. A failed
// upload is a toast and the tile goes away, so the grid never holds a broken photo.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, ImageAdd01Icon, LoaderCircleIcon, LockIcon } from '@hugeicons/core-free-icons';

import { requestTrustedSellerReview } from '@/lib/actions/trustedSellers';
import { uploadTrustedSellerPhoto } from '@/lib/storage/uploadTrustedSellerPhoto';
import { TRUSTED_SELLER_PHOTO_ACCEPT } from '@/lib/storage/trustedSellerPhotosShared';
import {
  APPLICATION_DETAILS_MAX,
  APPLICATION_PHOTOS_MAX,
} from '@/domain/trustedSellers/application';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PendingLabel } from '@/components/ui/pending-label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/** A photo already on the application, with a signed URL to preview it. */
export interface ExistingApplicationPhoto {
  path: string;
  url: string | null;
}

type Tile =
  | { key: string; state: 'uploading'; preview: string }
  | { key: string; state: 'ready'; path: string; preview: string | null };

export interface TrustedSellerApplicationFormProps {
  initialDetails: string;
  initialPhotos: ExistingApplicationPhoto[];
  /** "Send application" for a first submission, "Save changes" for an edit. */
  submitLabel: string;
}

const PLACEHOLDER = [
  'For example:',
  '• Where you sell now (Instagram, eBay, Facebook groups, a shop, markets) and your handles',
  '• How long you’ve been selling, and roughly how many sales',
  '• Which games you sell',
  '• Anyone who can vouch for you',
].join('\n');

export function TrustedSellerApplicationForm({
  initialDetails,
  initialPhotos,
  submitLabel,
}: TrustedSellerApplicationFormProps) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [details, setDetails] = useState(initialDetails);
  const [tiles, setTiles] = useState<Tile[]>(() =>
    initialPhotos.map((photo) => ({ key: photo.path, state: 'ready', path: photo.path, preview: photo.url })),
  );
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Object URLs for local previews are released when the tile goes or the form unmounts.
  const objectUrls = useRef(new Set<string>());
  useEffect(() => {
    const urls = objectUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const uploading = tiles.some((tile) => tile.state === 'uploading');
  const room = APPLICATION_PHOTOS_MAX - tiles.length;

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).slice(0, Math.max(room, 0));
    if (files.length > picked.length) {
      toast.error(`You can add up to ${APPLICATION_PHOTOS_MAX} photos.`);
    }

    for (const file of picked) {
      const key = `${file.name}-${file.size}-${crypto.randomUUID()}`;
      const preview = URL.createObjectURL(file);
      objectUrls.current.add(preview);
      setTiles((current) => [...current, { key, state: 'uploading', preview }]);

      const result = await uploadTrustedSellerPhoto(file);
      if (result.ok) {
        setTiles((current) =>
          current.map((tile) =>
            tile.key === key ? { key, state: 'ready', path: result.path, preview } : tile,
          ),
        );
      } else {
        toast.error(result.message);
        setTiles((current) => current.filter((tile) => tile.key !== key));
      }
    }
  }

  function removeTile(key: string) {
    setTiles((current) => current.filter((tile) => tile.key !== key));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploading) return;
    setFieldError(null);
    setSending(true);
    const result = await requestTrustedSellerReview({
      details,
      photoPaths: tiles.flatMap((tile) => (tile.state === 'ready' ? [tile.path] : [])),
    });
    setSending(false);

    if (result.ok) {
      toast.success('Application sent. We’ll let you know here when it’s reviewed.');
      router.replace('/trusted-sellers/apply');
      router.refresh();
      return;
    }
    if (result.field === 'details') {
      setFieldError(result.message);
      return;
    }
    toast.error(result.message);
  }

  return (
    <form onSubmit={submit} noValidate className="rounded-xl border border-border bg-card p-group md:p-section">
      <div className="space-y-tight">
        <div className="flex flex-wrap items-baseline justify-between gap-x-cozy">
          <Label htmlFor="trusted-details" className="text-lead font-semibold">
            Tell us about your selling
          </Label>
          <span className="inline-flex items-center gap-tight text-meta text-muted-foreground">
            <HugeiconsIcon icon={LockIcon} className="size-3.5" aria-hidden />
            Only our team sees this
          </span>
        </div>
        <Textarea
          id="trusted-details"
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          placeholder={PLACEHOLDER}
          maxLength={APPLICATION_DETAILS_MAX}
          rows={9}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? 'trusted-details-error' : 'trusted-details-count'}
          className="leading-relaxed"
        />
        <div className="flex items-start justify-between gap-cozy">
          {fieldError ? (
            <p id="trusted-details-error" role="alert" className="text-body text-destructive">
              {fieldError}
            </p>
          ) : (
            <span />
          )}
          <span id="trusted-details-count" className="shrink-0 text-meta tabular-nums text-muted-foreground">
            {details.length.toLocaleString('en-AU')} / {APPLICATION_DETAILS_MAX.toLocaleString('en-AU')}
          </span>
        </div>
      </div>

      <div className="mt-section space-y-snug">
        <div>
          <p className="text-body font-semibold text-foreground">Photos</p>
          <p className="text-pretty text-body text-muted-foreground">
            Optional. Screenshots of feedback or vouches, sold listings, your stall: anything that
            backs up what you&rsquo;ve told us. Up to {APPLICATION_PHOTOS_MAX}.
          </p>
        </div>

        <ul className="grid grid-cols-3 gap-snug sm:grid-cols-5">
          {tiles.map((tile, index) => (
            <li key={tile.key} className="relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
              {tile.preview ? (
                // A local object URL or a short-lived signed URL: neither is a host the
                // image optimizer knows, so a plain <img> is the right element here.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={tile.preview} alt={`Photo ${index + 1}`} className="size-full object-cover" />
              ) : (
                <span className="grid size-full place-items-center text-meta text-muted-foreground">
                  Photo {index + 1}
                </span>
              )}
              {tile.state === 'uploading' ? (
                <span className="absolute inset-0 grid place-items-center bg-background/70" role="status">
                  <HugeiconsIcon icon={LoaderCircleIcon} className="size-5 animate-spin" aria-hidden />
                  <span className="sr-only">Uploading</span>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => removeTile(tile.key)}
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
          accept={TRUSTED_SELLER_PHOTO_ACCEPT}
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
        <p className="text-pretty text-body text-muted-foreground">
          You can edit this until we&rsquo;ve reviewed it.
        </p>
        <Button type="submit" disabled={sending || uploading} className="shrink-0">
          <PendingLabel pending={sending} pendingLabel="Sending…">
            {uploading ? 'Uploading photos…' : submitLabel}
          </PendingLabel>
        </Button>
      </div>
    </form>
  );
}
