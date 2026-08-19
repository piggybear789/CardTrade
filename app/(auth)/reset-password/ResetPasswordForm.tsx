"use client";

// app/(auth)/reset-password/ResetPasswordForm.tsx
//
// Sets a new password after the recovery email has exchanged a session.

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { updatePassword } from "@/lib/actions/auth";
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

export function ResetPasswordForm({ hasSession }: { hasSession: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  useEffect(() => setIsReady(true), []);

  const passwordId = useId();
  const confirmId = useId();
  const passwordErrorId = `${passwordId}-error`;
  const formErrorId = `${passwordId}-form-error`;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");

    setPasswordError(null);
    setFormError(null);

    if (password !== confirm) {
      setPasswordError("Passwords do not match.");
      return;
    }

    startTransition(async () => {
      const result = await updatePassword(password);
      if (!result.ok) {
        if (result.field === "password") {
          setPasswordError(result.message);
          return;
        }
        setFormError(result.message);
        toast.error(result.message);
        return;
      }
      toast.success("Password updated.");
      router.push("/listings");
      router.refresh();
    });
  }

  return (
    <Card className="w-full max-w-md border-border bg-card shadow-market">
      <CardHeader>
        <h1 className="text-head font-semibold leading-none tracking-tight">
          Choose a new password
        </h1>
        <CardDescription>
          {hasSession
            ? "Enter a new password for this account."
            : "This reset link is invalid or has expired."}
        </CardDescription>
      </CardHeader>
      {hasSession ? (
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
              <Label htmlFor={passwordId}>New password</Label>
              <Input
                id={passwordId}
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                required
                disabled={isPending}
                aria-invalid={passwordError ? true : undefined}
                aria-describedby={passwordError ? passwordErrorId : undefined}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={confirmId}>Confirm password</Label>
              <Input
                id={confirmId}
                name="confirm"
                type="password"
                autoComplete="new-password"
                placeholder="Repeat the new password"
                required
                disabled={isPending}
                aria-invalid={passwordError ? true : undefined}
                aria-describedby={passwordError ? passwordErrorId : undefined}
              />
              {passwordError ? (
                <p id={passwordErrorId} role="alert" className="text-body text-destructive">
                  {passwordError}
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
              {isPending ? "Updating…" : "Update password"}
            </Button>
          </CardFooter>
        </form>
      ) : (
        <CardFooter className="flex flex-col gap-4">
          <Button asChild className="w-full">
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
