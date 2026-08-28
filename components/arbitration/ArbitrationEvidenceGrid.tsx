'use client';

// Clicking an evidence photo opens the same lightbox the contract rooms use,
// instead of dumping the signed URL into a new tab.

import { useState } from 'react';
import Image from 'next/image';

import { ContractImageLightbox } from '@/components/contract/ContractImageLightbox';
import type { DisputeEvidenceEntry } from '@/lib/actions/disputeEvidence';
import { isVideoPath } from '@/lib/storage/disputeEvidenceShared';

function EvidenceMedia({
  path,
  url,
  onOpen,
}: {
  path: string;
  url: string | null;
  onOpen?: () => void;
}) {
  if (!url) {
    return (
      <div className="grid aspect-square place-items-center rounded-md border border-dashed bg-muted px-snug text-center text-meta leading-tight text-muted-foreground">
        Unavailable
      </div>
    );
  }

  if (isVideoPath(path)) {
    return (
      <video
        src={url}
        controls
        preload="metadata"
        className="aspect-square w-full rounded-md border bg-obsidian object-contain"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative aspect-square overflow-hidden rounded-md border focus:outline-none focus-visible:border-iris"
    >
      <Image
        src={url}
        alt="Evidence"
        fill
        unoptimized
        className="object-cover transition-transform group-hover:scale-105"
      />
    </button>
  );
}

export function ArbitrationEvidenceGrid({
  media,
}: {
  media: DisputeEvidenceEntry['media'];
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const photoUrls = media.flatMap((item) =>
    item.url && !isVideoPath(item.path) ? [item.url] : [],
  );

  return (
    <>
      <div className="mt-cozy grid grid-cols-3 gap-snug sm:grid-cols-4">
        {media.map((item) => {
          const photoIndex =
            item.url && !isVideoPath(item.path) ? photoUrls.indexOf(item.url) : -1;
          return (
            <EvidenceMedia
              key={item.path}
              path={item.path}
              url={item.url}
              onOpen={photoIndex >= 0 ? () => setLightboxIndex(photoIndex) : undefined}
            />
          );
        })}
      </div>
      <ContractImageLightbox
        images={photoUrls}
        openIndex={lightboxIndex}
        onOpenChange={setLightboxIndex}
        label="Evidence"
      />
    </>
  );
}
