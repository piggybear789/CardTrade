'use client';

// components/editor/DevicePreview.tsx
//
// The devices the full-screen editors (`/deals`, `/listings/new`) draw their live
// preview in: a real-proportion iPhone and a laptop browser window, scaled as one
// piece to fit the canvas by `DeviceStage`. Moved out of `DealComposeForm` so both
// editors draw the same device, not two look-alikes.

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { LockIcon, Search01Icon } from '@hugeicons/core-free-icons';
import { LogoMark } from '@/components/layout/Logo';
import { GUEST_MOBILE_HUBS } from '@/components/layout/marketplace-nav-config';
import { cn } from '@/lib/utils';
import { PHONE } from '@/components/editor/devices';

export { BROWSER, PHONE } from '@/components/editor/devices';


/**
 * Centres a device of a fixed natural size in the space it is given, scaled to fit
 * (never past life size).
 *
 * THE BOX IS MEASURED, NOT THE SCALE. The stage's own size is stored, and the scale is
 * worked out from it during render, so switching phone to desktop draws the new
 * device at its right size in the same frame. Storing the scale meant the switch drew
 * the 1024px browser at the phone's scale (or at full size) until the observer fired
 * again, and with nothing clipping it that spilled past the pane and put a scrollbar
 * on the page for a frame: the jump on every toggle. The first measure is taken in a
 * layout effect, before paint, and the stage clips, so nothing can ever spill out.
 */
export function DeviceStage({
  width,
  height,
  children,
}: {
  width: number;
  height: number;
  children: ReactNode;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const read = (w: number, h: number) => {
      if (w <= 0 || h <= 0) return;
      setBox((prev) => (prev && prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    const rect = stage.getBoundingClientRect();
    read(rect.width, rect.height);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) read(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  const scale = box ? Math.min(box.width / width, box.height / height, 1) : null;
  return (
    <div ref={stageRef} className="relative size-full overflow-hidden">
      <div
        className={cn('absolute left-1/2 top-1/2', scale == null && 'invisible')}
        style={{
          width,
          height,
          transform: `translate(-50%, -50%) scale(${scale ?? 0})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
const DEVICE_SHADOW =
  'shadow-[0_2px_4px_hsl(var(--obsidian)/0.06),0_32px_64px_-24px_hsl(var(--obsidian)/0.35)]';

/**
 * An iPhone: a dark bezel, the Dynamic Island, the status bar and Safari's address
 * bar, then the page as a phone draws it for a signed-out visitor: the marketing
 * strip (`MarketingChrome`), the content column (`PageShell`'s phone padding), and
 * the guest tab bar (`MobileBottomNav`) over the home indicator.
 */
export function PhoneDevice({
  children,
  header,
  contentClassName,
}: {
  children: ReactNode;
  /** The site's own strip under Safari's bar. Defaults to the guest marketing strip. */
  header?: ReactNode;
  /** Replaces the content column's `PageShell` padding. */
  contentClassName?: string;
}) {
  return (
    <div
      className={cn('relative size-full rounded-[66px] bg-obsidian', DEVICE_SHADOW)}
      style={{ padding: PHONE.bezel }}
    >
      {/* Side buttons: action and volume on the left, power on the right. */}
      <span className="absolute -left-[3px] top-[128px] h-[34px] w-[3px] rounded-l-sm bg-obsidian" />
      <span className="absolute -left-[3px] top-[188px] h-[60px] w-[3px] rounded-l-sm bg-obsidian" />
      <span className="absolute -left-[3px] top-[260px] h-[60px] w-[3px] rounded-l-sm bg-obsidian" />
      <span className="absolute -right-[3px] top-[210px] h-[96px] w-[3px] rounded-r-sm bg-obsidian" />

      <div className="relative flex size-full flex-col overflow-hidden rounded-[55px] bg-background">
        {/* Status bar, 54pt, with the Dynamic Island in it. */}
        <div className="relative flex h-[54px] shrink-0 items-center justify-between px-[34px] pt-[6px]">
          <span className="text-[17px] font-semibold tracking-[-0.02em] text-foreground">9:41</span>
          <span className="flex items-center gap-[6px] text-foreground">
            <SignalGlyph />
            <WifiGlyph />
            <BatteryGlyph />
          </span>
          <span className="absolute left-1/2 top-[11px] h-[37px] w-[126px] -translate-x-1/2 rounded-full bg-black" />
        </div>
        {/* Safari's address bar. */}
        <div className="flex h-[44px] shrink-0 items-center justify-center px-group">
          <span className="flex h-[34px] w-full items-center justify-center gap-1.5 rounded-full bg-muted text-[15px] text-foreground">
            <HugeiconsIcon icon={LockIcon} className="size-3.5 text-muted-foreground" />
            noditto.app
          </span>
        </div>
        {/* `MarketingChrome`: the wordmark home link and Sign in. */}
        {header ?? (
          <div className="flex min-h-10 shrink-0 items-center gap-1.5 px-3 pb-1.5 pt-2">
            <span className="inline-flex min-h-10 items-center gap-snug px-tight">
              <LogoMark className="size-7" />
              <span className="font-wordmark text-body font-bold" translate="no">
                NoDitto
              </span>
            </span>
            <span className="ml-auto inline-flex h-10 items-center px-cozy text-body font-semibold text-foreground">
              Sign in
            </span>
          </div>
        )}
        {/* `PageShell` below `sm`: 16px sides, 32px top. */}
        <div className={cn('min-h-0 flex-1 overflow-hidden', contentClassName ?? 'px-4 pt-section')}>{children}</div>
        {/* `MobileBottomNav` for a guest, over the 34pt home-indicator inset. */}
        <div className="shrink-0 border-t border-border bg-card shadow-[0_-8px_28px_hsl(var(--foreground)/0.06)]">
          <div className="grid h-14 grid-cols-5">
            {GUEST_MOBILE_HUBS.map((hub) => (
              <span
                key={hub.id}
                className="flex flex-col items-center justify-center gap-0.5 px-0.5 text-meta font-medium text-muted-foreground"
              >
                <HugeiconsIcon icon={hub.icon} className="size-5" />
                <span className="truncate">{hub.label}</span>
              </span>
            ))}
          </div>
          <div className="flex h-[34px] items-end justify-center pb-[8px]">
            <span className="h-[5px] w-[134px] rounded-full bg-foreground" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A browser window, then the page as a laptop draws it for a signed-out visitor:
 * the site header (`SiteHeader`, guest links) and the invite in `PageShell`'s
 * centred `max-w-lg` column.
 */
export function BrowserDevice({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex size-full flex-col overflow-hidden rounded-[14px] border border-border bg-background',
        DEVICE_SHADOW,
      )}
    >
      <div className="flex h-11 shrink-0 items-center gap-group border-b border-border bg-muted/60 px-group">
        <span className="flex shrink-0 gap-2">
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
        </span>
        <span className="mx-auto flex h-7 w-[26rem] items-center justify-center gap-1.5 rounded-md bg-background text-body text-muted-foreground">
          <HugeiconsIcon icon={LockIcon} className="size-3.5" />
          noditto.app/t/your-link
        </span>
        <span className="w-[3.25rem] shrink-0" />
      </div>
      {/* `SiteHeader` from `md`, as a guest sees it. */}
      <div className="flex h-16 shrink-0 items-center gap-6 border-b border-border px-8">
        <span className="flex items-center gap-snug">
          <LogoMark />
          <span className="font-wordmark text-subhead font-bold" translate="no">
            NoDitto
          </span>
        </span>
        <span className="flex gap-1 text-lead font-semibold text-foreground">
          <span className="px-cozy">Marketplace</span>
          <span className="px-cozy">References</span>
        </span>
        <span className="flex h-9 min-w-0 flex-1 items-center gap-snug rounded-md bg-muted px-3 text-body text-muted-foreground">
          <HugeiconsIcon icon={Search01Icon} className="size-4" />
          Search cards, @handles, or sellers…
        </span>
        <span className="flex items-center gap-tight">
          <span className="px-cozy text-body font-medium text-foreground">Sign in</span>
          <span className="rounded-md bg-primary px-cozy py-1.5 text-body font-medium text-primary-foreground">
            Get started
          </span>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-background px-8 pt-10">{children}</div>
    </div>
  );
}

function SignalGlyph() {
  return (
    <span className="flex h-[12px] items-end gap-[1.5px]" aria-hidden>
      {[4, 6, 8.5, 11].map((height) => (
        <span key={height} className="w-[3px] rounded-[1px] bg-current" style={{ height }} />
      ))}
    </span>
  );
}

function WifiGlyph() {
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden className="fill-current">
      <path d="M8 2.4c2.3 0 4.4.9 6 2.4l1.1-1.2A10.2 10.2 0 0 0 8 .7C5.3.7 2.8 1.8.9 3.6L2 4.8a8.5 8.5 0 0 1 6-2.4Z" />
      <path d="M8 5.8c1.4 0 2.6.5 3.6 1.4l1.1-1.2A7 7 0 0 0 8 4.1 7 7 0 0 0 3.3 6l1.1 1.2c1-.9 2.2-1.4 3.6-1.4Z" />
      <path d="M8 9.2c.5 0 1 .2 1.3.5L8 11.2 6.7 9.7c.3-.3.8-.5 1.3-.5Z" />
    </svg>
  );
}

function BatteryGlyph() {
  return (
    <span className="flex items-center gap-[1px]" aria-hidden>
      <span className="flex h-[12px] w-[24px] items-center rounded-[3.5px] border border-foreground/40 p-[1.5px]">
        <span className="h-full w-full rounded-[2px] bg-foreground" />
      </span>
      <span className="h-[4px] w-[1.5px] rounded-r-sm bg-foreground/40" />
    </span>
  );
}
