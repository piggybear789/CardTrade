"use client";

// app/(auth)/forgot-password/ForgotPasswordForm.tsx
//
// Requests a password-reset email. Success copy is identical whether or not
// the address is registered.

import { useEffect, useId, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { requestPasswordReset } from "@/lib/actions/auth";
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

function safePath(target: string | null): string | null {
  if (target && target.startsWith("/") && !target.startsWith("//")) {
    return target;
  }
  return null;
}

function withRedirect(path: string, destination: string | null): string {
  return destination
    ? `${path}?redirectTo=${encodeURIComponent(destination)}`
    : path;
}

export function ForgotPasswordForm() {
  const searchParams = useSearchParams();
  const destination = safePath(searchParams.get("redirectTo"));
  const [isPending, startTransition] = useTransition();
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isReady, setIsReady] = useState(false);
  useEffect(() => setIsReady(true), []);

  const emailId = useId();
  const emailErrorId = `${emailId}-error`;
  const formErrorId = `${emailId}-form-error`;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");

    setEmailError(null);
    setFormError(null);

    startTransition(async () => {
      const result = await requestPasswordReset(email);
      if (!result.ok) {
        if (result.field === "email") {
          setEmailError(result.message);
          return;
        }
        setFormError(result.message);
        toast.error(result.message);
        return;
      }
      setSent(true);
    });
  }

  return (
    <Card className="w-full max-w-md border-border bg-card shadow-market">
      <CardHeader>
        <h1 className="text-head font-semibold leading-none tracking-tight">
          Reset your password
        </h1>
        <CardDescription>
          Enter the email on your account. If it is registered, we will send a
          reset link.
        </CardDescription>
      </CardHeader>
      {sent ? (
        <CardContent className="space-y-4">
          <p role="status" className="text-body text-muted-foreground">
            If an account exists for that email, we sent a reset link. Check
            your inbox and spam folder.
          </p>
        </CardContent>
      ) : (
        <form onSubmit={handleSubmit} method="post" noValidate>
          <CardContent className="space-y-4">
            {formError ? (
              <p
                id={formErrorId}
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-body text-destructive"
              >
                {formError}
              </p>
            ) : null}
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
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? emailErrorId : undefined}
              />
              {emailError ? (
                <p id={emailErrorId} role="alert" className="text-body text-destructive">
                  {emailError}
                </p>
              ) : null}
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button
              type="submit"
              className="w-full"
              disabled={isPending || !isReady}
              aria-busy={isPending}
            >
              {isPending ? "Sending…" : "Send reset link"}
            </Button>
            <p className="text-body text-muted-foreground">
              <Link
                href={withRedirect("/sign-in", destination)}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Back to sign in
              </Link>
            </p>
          </CardFooter>
        </form>
      )}
      {sent ? (
        <CardFooter className="flex flex-col gap-4">
          <p className="text-body text-muted-foreground">
            <Link
              href={withRedirect("/sign-in", destination)}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Back to sign in
            </Link>
          </p>
        </CardFooter>
      ) : null}
    </Card>
  );
}
