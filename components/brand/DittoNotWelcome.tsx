// Hero kicker (and a quieter footer callback). The rest of the app is one
// typeface; this is the single exception — a ballpoint scribble in place of
// the usual uppercase label.

import { Reenie_Beanie } from 'next/font/google';

import { cn } from '@/lib/utils';

const scrawl = Reenie_Beanie({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
});

export function DittoNotWelcome({
  className,
  quiet = false,
  compact = false,
}: {
  className?: string;
  /** Smaller callback line — used once in the footer, not as a second hero. */
  quiet?: boolean;
  /** Dialog-scale scrawl — same words as the hero. */
  compact?: boolean;
}) {
  const sizeClass = quiet
    ? 'text-[1.55rem]'
    : compact
      ? 'text-[1.65rem] sm:text-[1.85rem]'
      : 'text-[1.75rem] sm:text-[2.4rem] lg:text-[2.85rem]';

  return (
    <span
      aria-hidden="true"
      translate="no"
      className={cn('mx-auto flex w-fit flex-col items-center', className)}
    >
      {/* Bigger, not bolder — the natural ballpoint weight at a larger size
          reads better than a faux-bold stroke. */}
      <span
        className={cn(
          scrawl.className,
          'block -rotate-[4deg] select-none leading-none text-ditto',
          sizeClass,
        )}
      >
        {quiet ? 'still not welcome' : 'ditto not welcome'}
      </span>
      {quiet ? null : (
        <svg
          viewBox="0 0 168 10"
          className={cn(
            '-mt-0.5 -rotate-[3deg] text-ditto',
            compact ? 'h-2 w-[9.5rem] sm:w-[10.5rem]' : 'h-2.5 w-[9.5rem] sm:w-[12rem] lg:w-[13.5rem]',
          )}
        >
          <path
            d="M2 6.5c28-4 52 3.5 80-1.5 22-4 42 3 84 0"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2.1"
          />
        </svg>
      )}
    </span>
  );
}
