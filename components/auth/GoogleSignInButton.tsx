"use client";

// components/auth/GoogleSignInButton.tsx
//
// Google OAuth entry point for the sign-in and sign-up pages (Req 1.1, 1.7).
//
// Calls the `signInWithGoogle` server action so the PKCE verifier is stored in a
// server-set cookie, then performs a full-page navigation to Google's consent
// screen. A full navigation (not router.push) is required because the target is
// an external origin. The round-trip lands on /auth/callback, which creates the
// Profile on first sign-in.

import { useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { signInWithGoogle } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";

/** Google's brand mark, inlined because lucide-react ships no brand icons. */
function GoogleIcon() {
  return (
    <svg className="size-4" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.34A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9.01 9.01 0 0 0 0 8.09l3.01-2.34Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/**
 * Renders the "Continue with Google" button.
 *
 * @param mode - Only affects the label wording; the OAuth flow is identical for
 *   sign-in and sign-up because Google decides whether the account is new.
 * @param disabled - Set while the sibling credentials form is submitting.
 */
export function GoogleSignInButton({
  mode,
  disabled,
}: {
  mode: "sign-in" | "sign-up";
  disabled?: boolean;
}) {
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await signInWithGoogle(searchParams.get("redirectTo") ?? undefined);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      // External origin: bypass the Next router.
      window.location.assign(result.url);
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={handleClick}
      disabled={disabled || isPending}
    >
      {isPending ? (
        "Redirecting to Google…"
      ) : (
        <>
          <GoogleIcon />
          {mode === "sign-up" ? "Sign up with Google" : "Continue with Google"}
        </>
      )}
    </Button>
  );
}
