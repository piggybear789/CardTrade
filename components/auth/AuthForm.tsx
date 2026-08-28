"use client";

// components/auth/AuthForm.tsx
//
// Shared credentials form for the sign-in and sign-up pages (Req 1.1–1.3, 1.7).
// A Client Component that submits to the `signIn` / `signUp` server actions and
// renders inline, field-level validation errors from the returned ActionResult
// (`field` + `message`). On success it redirects with next/navigation:
//   - sign-in  -> the sanitized `redirectTo` query param, else /listings
//   - sign-up  -> /onboarding (preserving redirectTo) or /sign-in when email
//     confirmation is pending
//
// Google OAuth sits alongside the credentials fields via GoogleSignInButton;
// that flow redirects out to Google and returns through /auth/callback, which
// reports any failure back here in the `authError` query param.

import { useEffect, useId, useState, useTransition } from "react";
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
    description: "A few details to get you on the floor.",
    submitLabel: "Create account",
    pendingLabel: "Creating account…",
    switchPrompt: "Already have an account?",
    switchHref: "/sign-in",
    switchCta: "Sign in",
    autoComplete: "new-password",
  },
};

/** Where a User with no explicit destination lands after signing in. */
const DEFAULT_DESTINATION = "/";

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
  const [acceptedTerms, setAcceptedTerms] = useState(false);

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

  /**
   * Whether this component has hydrated on the client.
   *
   * The submit control is disabled until it has, which closes the window in which a
   * submit would bypass `handleSubmit` entirely and fall back to a native form post.
   * `method="post"` on the <form> keeps that fallback from leaking the password;
   * this keeps it from happening at all.
   *
   * No cost to a real member: the effect runs on the first client render, so the
   * button is enabled before it can be aimed at. And nothing is lost for a
   * JS-disabled visitor, because this form CANNOT work without JS — it calls a
   * client action — so a submit that reached the server would fail regardless.
   */
  const [isReady, setIsReady] = useState(false);
  useEffect(() => setIsReady(true), []);

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
          if (result.error === 'ACCOUNT_BANNED') {
            router.push('/account-suspended');
            return;
          }
          // AN UNCONFIRMED ADDRESS IS NOT A BAD PASSWORD. Retrying here can never
          // succeed, so send them straight to the screen that can resend the link,
          // carrying the address they just typed so they need not retype it.
          if (result.error === 'EMAIL_NOT_CONFIRMED') {
            toast.error(result.message);
            router.push(
              `/forgot-password?intent=confirm&email=${encodeURIComponent(email)}`,
            );
            return;
          }
          applyError(result.field, result.message);
          return;
        }
        
        router.push(destination ?? DEFAULT_DESTINATION);
        router.refresh();
        return;
      }

      if (!acceptedTerms) {
        setFormError("Accept the Terms and Privacy Policy to create an account.");
        return;
      }

      const result = await signUp(email, password);
      if (!result.ok) {
        applyError(result.field, result.message);
        return;
      }
      if (result.data.emailConfirmationRequired) {
        
        router.push(withRedirect("/sign-in", destination));
        return;
      }
      
      router.push(withRedirect("/onboarding", destination));
      router.refresh();
    });
  }

  /** Route a failure message to its input, or to the form-level banner. */
  function applyError(field: string | undefined, message: string) {
    if (field === "email" || field === "password") {
      setFieldErrors({ [field]: message });
      return;
    }
    setFormError(message);
    toast.error(message);
  }

  return (
    <Card className="w-full max-w-md border-border bg-card shadow-market">
      <CardHeader className="items-center text-center">
        {/* The auth pages have no shell-provided heading, so the card title is
            the page's single h1. CardTitle renders a div, so use a semantic
            heading carrying the same styling. */}
        <h1 className="text-head font-semibold leading-none tracking-tight text-balance">
          {copy.title}
        </h1>
        <CardDescription className="text-pretty">
          {copy.description}
        </CardDescription>
      </CardHeader>
      {/*
        `method="post"` MATTERS EVEN THOUGH SUBMIT IS HANDLED IN JS.

        `handleSubmit` calls `preventDefault`, so this method is never used on the
        happy path. It is here for the window before hydration: a submit that lands
        while React has not yet attached falls back to the browser default, and the
        default for a form with no method is a GET to the current URL — which
        serialises every field into the query string. That was observed in the wild
        as `/sign-in?email=…&password=password123`, putting the password into browser
        history, the server access log, and any referrer.

        POST does not make the pre-hydration submit succeed. It makes it fail without
        leaking the credential, which is the whole requirement. `isReady` below closes
        the window itself.
      */}
      <form onSubmit={handleSubmit} method="post" noValidate>
        <CardContent className="space-y-4">
          {bannerError ? (
            <p
              id={formErrorId}
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-body text-destructive"
            >
              {bannerError}
            </p>
          ) : null}

          <GoogleSignInButton mode={mode} disabled={isPending} />

          <div className="flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            <span className="text-meta uppercase tracking-wide text-muted-foreground">or</span>
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
              className="min-h-11"
              aria-invalid={fieldErrors.email ? true : undefined}
              aria-describedby={fieldErrors.email ? emailErrorId : undefined}
            />
            {fieldErrors.email ? (
              <p id={emailErrorId} role="alert" className="text-body text-destructive">
                {fieldErrors.email}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            {/* The recovery route sits beside the field it rescues, which is where
                someone looks when the password they typed did not work. Sign-up has no
                password to recover yet, so it is offered on sign-in only. */}
            <div className="flex items-center justify-between gap-cozy">
              <Label htmlFor={passwordId}>Password</Label>
              {mode === 'sign-in' ? (
                <Link
                  href="/forgot-password"
                  className="inline-flex min-h-11 items-center text-meta text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Forgot password?
                </Link>
              ) : null}
            </div>
            <Input
              id={passwordId}
              name="password"
              type="password"
              autoComplete={copy.autoComplete}
              placeholder="At least 8 characters"
              required
              disabled={isPending}
              className="min-h-11"
              aria-invalid={fieldErrors.password ? true : undefined}
              aria-describedby={fieldErrors.password ? passwordErrorId : undefined}
            />
            {fieldErrors.password ? (
              <p id={passwordErrorId} role="alert" className="text-body text-destructive">
                {fieldErrors.password}
              </p>
            ) : null}
          </div>

          {mode === "sign-up" ? (
            <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2.5 text-center text-body text-muted-foreground">
              <input
                type="checkbox"
                name="acceptedTerms"
                checked={acceptedTerms}
                onChange={(event) => setAcceptedTerms(event.target.checked)}
                disabled={isPending}
                className="size-5 shrink-0"
                required
              />
              <span>
                I accept the{" "}
                <Link
                  href="/terms"
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  Terms
                </Link>{" "}
                and{" "}
                <Link
                  href="/privacy"
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  Privacy
                </Link>{" "}
                policy.
              </span>
            </label>
          ) : null}
        </CardContent>

        <CardFooter className="flex flex-col items-center gap-4">
          <Button type="submit" className="min-h-11 w-full" disabled={isPending || !isReady} aria-busy={isPending}>
            {isPending ? copy.pendingLabel : copy.submitLabel}
          </Button>
          <p className="text-center text-body text-muted-foreground">
            {copy.switchPrompt}{" "}
            <Link
              href={withRedirect(copy.switchHref, destination)}
              className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
            >
              {copy.switchCta}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
