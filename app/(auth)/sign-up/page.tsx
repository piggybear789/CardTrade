import { Suspense } from "react";
import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/AuthForm";

export const metadata: Metadata = {
  title: "Create account · Poke-xchange",
};

// Sign-up page (Req 1.1–1.3). The form is a Client Component wrapped in a
// Suspense boundary because it reads search params via next/navigation.
export default function SignUpPage() {
  return (
    <main className="flex min-h-[calc(100dvh-4rem)] items-center justify-center bg-muted/40 px-4 py-8 sm:px-6">
      <Suspense fallback={null}>
        <AuthForm mode="sign-up" />
      </Suspense>
    </main>
  );
}
