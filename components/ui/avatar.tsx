'use client';

import * as React from 'react';

import { avatarUrl, initialsFor } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * A member's picture, or their initials.
 *
 * THE FALLBACK IS THE POINT. Avatars arrived in 0066, so every account that
 * existed before it has none and most members will never set one. The initials
 * branch is therefore the NORMAL rendering, not a degraded one — if it looked like
 * a failure state the change would make the app look broken rather than better.
 * It is also what renders when a Storage object 404s or an admin clears an abusive
 * picture, so it must never be a blank circle.
 *
 * Takes the stored object PATH, not a URL, and resolves it with `avatarUrl()`. That
 * keeps every call site honest: paths are what the database holds, and a component
 * that accepted a URL would push resolution out to a dozen callers.
 *
 * Deliberately NOT a Radix primitive. `@radix-ui/react-avatar` would add a
 * dependency for image-load state we handle in four lines, and its fallback is
 * delay-based — it flashes empty before showing initials, which is precisely the
 * broken-looking moment this needs to avoid.
 *
 * Decorative by default: the name is essentially always rendered as text beside it,
 * so the image carries `alt=""` and is hidden from assistive tech to avoid reading
 * the same name twice. Pass `alt` explicitly where the avatar stands alone.
 */
const SIZES = {
  xs: 'size-6 text-meta',
  sm: 'size-8 text-meta',
  md: 'size-10 text-body',
  lg: 'size-14 text-lead',
  xl: 'size-20 text-subhead',
} as const;

export type AvatarSize = keyof typeof SIZES;

export interface AvatarProps extends Omit<React.ComponentProps<'span'>, 'children'> {
  /** Stored object path in `profile-images`, or null. NOT a URL. */
  avatarPath?: string | null;
  /** Display name, used for the initials fallback. */
  displayName?: string | null;
  size?: AvatarSize;
  /**
   * Accessible label. Omit (the default) when the member's name is already
   * rendered as text nearby, so a screen reader does not announce it twice.
   */
  alt?: string;
}

function Avatar({
  avatarPath,
  displayName,
  size = 'md',
  alt,
  className,
  ...props
}: AvatarProps) {
  const src = avatarUrl(avatarPath);
  // Reset on src change so a member whose new upload also fails does not stay
  // stuck showing initials from the previous failure — and so switching between
  // members in a list never shows the wrong person's picture.
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);

  const showImage = Boolean(src) && !failed;

  return (
    <span
      className={cn(
        // `shrink-0` because these sit in flex rows beside names that can be long;
        // without it the circle squashes into an ellipse.
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full border border-border bg-muted font-semibold uppercase text-muted-foreground',
        SIZES[size],
        className,
      )}
      {...props}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src as string}
          alt={alt ?? ''}
          aria-hidden={alt ? undefined : true}
          className="size-full object-cover"
          // A member-supplied image on a page showing money: do not let it carry a
          // referrer, and decode off the main thread.
          referrerPolicy="no-referrer"
          decoding="async"
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden={alt ? undefined : true}>{initialsFor(displayName)}</span>
      )}
      {alt ? <span className="sr-only">{alt}</span> : null}
    </span>
  );
}

export { Avatar };
