import { cn } from "@/lib/utils";

/**
 * The unread count pill: red, white figure, capped at 99+. Renders nothing at zero.
 *
 * One component for every place a count of things waiting on the member is drawn —
 * the header bell, the phone tab bar, the Account activity rows — so a member learns
 * one mark. Decorative (`aria-hidden`): the control it sits on states the count in
 * its own accessible name, which is where a screen reader needs it.
 */
export function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-tight text-meta font-semibold leading-none text-destructive-foreground",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
