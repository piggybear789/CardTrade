"use client";

// components/auth/AuthForm.tsx
//
// Shared credentials form for the sign-in and sign-up pages (Req 1.1–1.3, 1.7).
// A Client Component that submits to the `signIn` / `signUp` server actions and
// renders inline, field-level validation errors from the returned ActionResult
// (`field` + `message`). On success it redirects with next/navigation:
//   - sign-in  -> the sanitized `redirectTo` query param, else /listings
//   - sign-up  -> /profile (or /sign-in when email confirmation is pending),
//     where payout/verification onboarding lives
//
// Google OAuth sits alongside the credentials fields via GoogleSignInButton;
// that flow redirects out to Google and returns through /auth/callback, which
// reports any failure back here in the `authError` query param.

import { useId, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { signIn, signUp } from "@/lib/actions/auth";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";

type Mode = "sign-in" | "sign-up";

interface FieldErrors {
  email?: string;
  password?: string;
}

const COPY: Record<
  Mode,
  {
    title: string;
    description: string;
    submitLabel: string;
    pendingLabel: string;
    switchPrompt: string;
    switchHref: string;
    switchCta: string;
    autoComplete: string;
  }
> = {
  "sign-in": {
    title: "Sign in",
    description: "Welcome back. Enter your credentials to continue.",
    submitLabel: "Sign in",
    pendingLabel: "Signing in…",
    switchPrompt: "New to NoDitto?",
    switchHref: "/sign-up",
    switchCta: "Create an account",
    autoComplete: "current-password",
  },
  "sign-up": {
    title: "Create your account",
    description: "Register to buy, sell, and trade collectibles.",
    submitLabel: "Create account",
    pendingLabel: "Creating account…",
    switchPrompt: "Already have an account?",
    switchHref: "/sign-in",
    switchCta: "Sign in",
    autoComplete: "new-password",
  },
};

/** Where a User with no explicit destination lands after signing in. */
const DEFAULT_DESTINATION = "/listings";

/**
 * Only permit same-origin, absolute-path redirects to avoid an open-redirect
 * via the `redirectTo` query param. Anything else is discarded.
 */
function safePath(target: string | null): string | null {
  if (target && target.startsWith("/") && !target.startsWith("//")) {
    return target;
  }
  return null;
}

/** Append a destination to a path as the `redirectTo` param, when there is one. */
function withRedirect(path: string, destination: string | null): string {
  return destination
    ? `${path}?redirectTo=${encodeURIComponent(destination)}`
    : path;
}

export function AuthForm({ mode }: { mode: Mode }) {
  const copy = COPY[mode];
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  // A failed OAuth round-trip comes back as ?authError=… from /auth/callback.
  // A local submission error takes precedence over that stale message.
  const bannerError = formError ?? searchParams.get("authError");

  // The task the User was trying to do when they hit the auth wall (joining a
  // deal link, say). It has to survive every hop from here: switching between
  // sign-in and sign-up, the sign-up KYC step, and email confirmation.
  const destination = safePath(searchParams.get("redirectTo"));

  const emailId = useId();
  const passwordId = useId();
  const emailErrorId = `${emailId}-error`;
  const passwordErrorId = `${passwordId}-error`;
  const formErrorId = `${emailId}-form-error`;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    setFieldErrors({});
    setFormError(null);

    startTransition(async () => {
      if (mode === "sign-in") {
        const result = await signIn(email, password);
        if (!result.ok) {
          applyError(result.field, result.message);
          return;
        }
        toast.success("Signed in.");
        router.push(destination ?? DEFAULT_DESTINATION);
        router.refresh();
        return;
      }

      const result = await signUp(email, password);
      if (!result.ok) {
        applyError(result.field, result.message);
        return;
      }
      if (result.data.emailConfirmationRequired) {
        toast.success("Account created. Check your email to confirm, then sign in.");
        router.push(withRedirect("/sign-in", destination));
        return;
      }
      toast.success("Account created.");
      router.push(destination ?? DEFAULT_DESTINATION);
      router.refresh();
    });
  }

  /** Route a failure message to its input, or to the form-level banner. */
  function applyError(field: string | undefined, message: string) {
    if (field === "email" || field === "password") {
      setFieldErrors({ [field]: message });
    } else {
      setFormError(message);
    }
    toast.error(message);
  }

  return (
    <Card className="w-full max-w-md border-border/80 bg-card shadow-market">
      <CardHeader>
        {/* The auth pages have no shell-provided heading, so the card title is
            the page's single h1. CardTitle renders a div, so use a semantic
            heading carrying the same styling. */}
        <h1 className="text-2xl font-semibold leading-none tracking-tight">
          {copy.title}
        </h1>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="space-y-4">
          {bannerError ? (
            <p
              id={formErrorId}
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {bannerError}
            </p>
          ) : null}

          <GoogleSignInButton mode={mode} disabled={isPending} />

          <div className="flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="space-y-2">
            <Label htmlFor={emailId}>Email</Label>
            <Input
              id={emailId}
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              required
              disabled={isPending}
              aria-invalid={fieldErrors.email ? true : undefined}
              aria-describedby={fieldErrors.email ? emailErrorId : undefined}
            />
            {fieldErrors.email ? (
              <p id={emailErrorId} role="alert" className="text-sm text-destructive">
                {fieldErrors.email}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor={passwordId}>Password</Label>
            <Input
              id={passwordId}
              name="password"
              type="password"
              autoComplete={copy.autoComplete}
              placeholder="At least 8 characters"
              required
              disabled={isPending}
              aria-invalid={fieldErrors.password ? true : undefined}
              aria-describedby={fieldErrors.password ? passwordErrorId : undefined}
            />
            {fieldErrors.password ? (
              <p id={passwordErrorId} role="alert" className="text-sm text-destructive">
                {fieldErrors.password}
              </p>
            ) : null}
          </div>
        </CardContent>

        <CardFooter className="flex flex-col gap-4">
          <Button type="submit" className="w-full" disabled={isPending} aria-busy={isPending}>
            {isPending ? copy.pendingLabel : copy.submitLabel}
          </Button>
          <p className="text-sm text-muted-foreground">
            {copy.switchPrompt}{" "}
            <Link
              href={withRedirect(copy.switchHref, destination)}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {copy.switchCta}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
