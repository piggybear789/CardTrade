'use client';

import * as React from 'react';

import { StorageImage } from '@/components/ui/storage-image';
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

/**
 * Painted width per size, paired with {@link SIZES} term for term — 6, 8, 10, 14
 * and 20 in Tailwind's 4px scale.
 *
 * KEPT BESIDE THE CLASSES BECAUSE IT IS THE SAME NUMBER TWICE. Getting one wrong
 * is not a visual bug, which is what makes it worth stating: the circle still
 * renders at the right size and simply fetches the wrong amount of data for it.
 * Before these existed every avatar pulled the full uploaded file, so a 24px
 * circle in an inbox row of twenty conversations was twenty original photos.
 */
const AVATAR_SIZES = {
  xs: '24px',
  sm: '32px',
  md: '40px',
  lg: '56px',
  xl: '80px',
} as const;

export type AvatarSize = keyof typeof SIZES;

/**
 * The initials' colours: a soft tint and a dark label of the same hue, picked from the
 * name so a member is the same colour on every surface.
 *
 * WHY COLOUR (2026-11-28, design-system audit). Initials are the normal rendering (see
 * above), and they were all one grey disc with a grey border, so an inbox of twenty
 * conversations was twenty identical placeholders and the eye had nothing to tell the
 * rows apart by except reading every name. Slack, Linear and Gmail tint initials per
 * person for exactly that reason. Eight hues, all at the same lightness so none is
 * louder than another; every label clears 6:1 on its tint. Not the brand violet alone,
 * and never `--destructive` red, which would read as an error.
 *
 * Inline style rather than classes: the eight pairs are one table here, not sixteen
 * arbitrary utilities, and no call site sets an avatar colour of its own.
 */
const INITIALS_TONES = [
  { backgroundColor: 'hsl(250 92% 95%)', color: 'hsl(250 52% 42%)' },
  { backgroundColor: 'hsl(212 96% 93%)', color: 'hsl(214 66% 34%)' },
  { backgroundColor: 'hsl(174 62% 89%)', color: 'hsl(176 78% 22%)' },
  { backgroundColor: 'hsl(140 58% 90%)', color: 'hsl(142 64% 24%)' },
  { backgroundColor: 'hsl(44 96% 88%)', color: 'hsl(28 78% 28%)' },
  { backgroundColor: 'hsl(18 100% 92%)', color: 'hsl(14 66% 36%)' },
  { backgroundColor: 'hsl(334 88% 94%)', color: 'hsl(334 58% 38%)' },
  { backgroundColor: 'hsl(214 32% 91%)', color: 'hsl(217 32% 30%)' },
] as const;

/** FNV-1a over the trimmed, lower-cased name; the same name always lands on the same tone. */
function initialsTone(displayName?: string | null) {
  const key = (displayName ?? '').trim().toLowerCase();
  if (!key) return INITIALS_TONES[INITIALS_TONES.length - 1];
  let hash = 0x811c9dc5;
  for (const char of key) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return INITIALS_TONES[hash % INITIALS_TONES.length];
}

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
        //
        // NO BORDER. The 1px `--border` ring drew every avatar as an outlined
        // placeholder. A photo takes an 8% ink hairline INSIDE its edge instead
        // (`after:`, painted over the image, so a white background still has an
        // edge on a white page), the way Instagram and iOS draw a profile picture;
        // initials are a tinted disc and need no edge at all.
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold uppercase',
        showImage &&
          "bg-muted after:pointer-events-none after:absolute after:inset-0 after:rounded-full after:shadow-[inset_0_0_0_1px_hsl(var(--foreground)/0.08)] after:content-['']",
        SIZES[size],
        className,
      )}
      style={showImage ? undefined : initialsTone(displayName)}
      {...props}
    >
      {showImage ? (
        // THE PLAIN-`<img>` FALLBACK INSIDE `StorageImage` IS LOAD-BEARING HERE,
        // more than anywhere else it is used. `avatarUrl` passes absolute URLs
        // through untouched, and a Google sign-in supplies one on
        // `lh3.googleusercontent.com` — a host `images.remotePatterns` does not
        // list, which `next/image` answers by THROWING rather than by degrading.
        // Every OAuth member's avatar would have taken its page down with it.
        <StorageImage
          src={src as string}
          alt={alt ?? ''}
          aria-hidden={alt ? undefined : true}
          sizes={AVATAR_SIZES[size]}
          className="object-cover"
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
