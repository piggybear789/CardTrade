// app/profile/page.tsx
//
// Profile page (Req 1.4–1.6). A Server Component that loads the authenticated
// caller's own Profile via the cookie-bound server client — RLS
// (`profiles_owner_select`) guarantees a User can only read their own row, so
// only the owner can view/edit (Req 1.6). It renders the editable ProfileForm
// (client) and the payout/verification card (`PayoutOnboarding`), which is the
// single verification surface: "verified" is provider-approved Managed
// Merchant onboarding (`merchant_status = APPROVED` with settlements enabled),
// not a separate KYC step.

import { redirect } from "next/navigation";
import { CreditCard } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getPayoutSetupContext } from "@/lib/actions/merchant";
import { getPaymentMethodStatus } from "@/lib/actions/payments";
import { EditProfileDialog } from "@/components/profile/EditProfileDialog";
import { PayoutOnboarding } from "@/components/profile/PayoutOnboarding";
import { AddPaymentMethodDialog } from "@/components/payments/AddPaymentMethodDialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MarketplaceShell } from "@/components/layout/MarketplaceShell";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { EmptyState } from "@/components/ui/empty-state";

// This page reads the authenticated user's cookies, so it must render
// dynamically (never statically prerendered at build time).
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await createClient();

  // Require an authenticated User; unauthenticated visitors are sent to sign-in
  // (Req 1.7). The subsequent read is RLS-scoped to the caller's own row.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/sign-in?redirectTo=/profile");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("display_name, contact_email")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    return (
      <MarketplaceShell title="Account" center>
        <EmptyState
          title="Account Unavailable"
          description="We couldn't load your account right now. Reload the page to try again."
          action={{ label: "Try Again", href: "/profile" }}
          compact
        />
      </MarketplaceShell>
    );
  }

  // Seller payout state + whether the test-mode compliance simulator is
  // available. Resolved on the server so the client never reads provider env.
  const payoutContext = await getPayoutSetupContext();

  // Display-safe saved-card summary: label only, never a token or source id.
  const paymentMethodResult = await getPaymentMethodStatus();
  const paymentMethod = paymentMethodResult.ok ? paymentMethodResult.data : null;

  return (
    <MarketplaceShell title="Account">
      <SectionHeader
        title="Account Settings"
        description="Manage your public identity, DittoShield status, and Pinch Payments payout details."
      />

      <div className="space-y-6">
        {/* Identity verification leads the page: it's the one thing that fully
            blocks listing, so it should be the first thing seen, not the last.
            Addressable so "Verify identity" links from other flows land here. */}
        <div id="payouts" className="scroll-mt-24">
          {payoutContext.ok ? <PayoutOnboarding context={payoutContext.data} /> : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Your details</CardTitle>
            <CardDescription>
              What other traders see when you buy, sell, or trade.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Display name
                </dt>
                <dd className="truncate text-sm font-semibold">
                  {profile.display_name}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Contact email
                </dt>
                <dd className="truncate text-sm font-semibold">
                  {profile.contact_email}
                </dd>
              </div>
            </dl>
            <EditProfileDialog
              displayName={profile.display_name}
              contactEmail={profile.contact_email}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">How you pay with Pinch Payments</CardTitle>
            <CardDescription>
              The card you buy with, and the one your collateral is held against.
              Card details go straight to Pinch Payments and never touch our servers.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Show what is saved. The label is display-only; the card itself
                lives at the provider. */}
            {paymentMethod?.hasPaymentMethod ? (
              <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
                <CreditCard className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {paymentMethod.label ?? "Card saved"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Saved with Pinch Payments for purchases and collateral.
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No Pinch Payments method saved.
              </p>
            )}

            <AddPaymentMethodDialog
              trigger={
                <Button type="button" variant="outline">
                  <CreditCard aria-hidden />
                  {paymentMethod?.hasPaymentMethod
                    ? "Replace payment method"
                    : "Add payment method"}
                </Button>
              }
            />
          </CardContent>
        </Card>
      </div>
    </MarketplaceShell>
  );
}
