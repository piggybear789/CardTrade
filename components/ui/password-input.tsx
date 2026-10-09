"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { EyeIcon, EyeOffIcon } from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/**
 * A password field with a show/hide button inside its right edge.
 *
 * The button is a real `<button type="button">` so it never submits the form, and
 * `aria-pressed` states whether the password is showing. It stays in the tab order:
 * a member checking what they typed on a phone is the case it exists for.
 */
const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<"input">, "type">
>(({ className, disabled, ...props }, ref) => {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <Input
        ref={ref}
        type={visible ? "text" : "password"}
        disabled={disabled}
        className={cn("pr-11", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        disabled={disabled}
        aria-pressed={visible}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-iris disabled:pointer-events-none"
      >
        <HugeiconsIcon icon={visible ? EyeOffIcon : EyeIcon} className="size-4" aria-hidden />
      </button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
