// app/listings/[id]/edit/page.tsx
//
// Edit-listing page (Req 3.4, 3.5, 3.7). A Server Component that:
//   - Redirects unauthenticated visitors to sign-in (Req 1.7).
//   - Loads the existing Item via `getItem` and prefills the client `ItemForm`.
//   - Enforces owner-only editing (Req 3.7): a non-owner (who may still see an
//     AVAILABLE item via RLS) gets a not-found response.
//   - Blocks editing of items that are not AVAILABLE (Req 3.5) with a message,
//     matching the guard the update action itself applies.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getItem } from "@/lib/actions/listings";
import { ItemForm } from "@/components/listings/ItemForm";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MarketplaceShell } from "@/components/layout/MarketplaceShell";

// Reads the authenticated user's session, so render dynamically.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Edit listing · Poke-xchange",
  description: "Update the details of your collectible listing.",
};

export default async function EditListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/sign-in?redirectTo=/listings/${id}/edit`);
  }

  // No KYC gate here (revised Req 3.1): an unverified Seller may list, so they
  // must be able to correct what they listed. `updateItem` enforces owner-only
  // access and the AVAILABLE-only rule, which are the constraints that matter.
  const result = await getItem(id);
  if (!result.ok) {
    notFound();
  }

  const item = result.data;

  // Owner-only editing (Req 3.7). RLS may surface an AVAILABLE item to any user,
  // so we explicitly deny edit access to non-owners.
  if (item.owner_id !== user.id) {
    notFound();
  }

  // Only AVAILABLE items are mutable (Req 3.5).
  if (item.status !== "AVAILABLE") {
    return (
      <MarketplaceShell title="Edit Listing" contentWidth="form" center>
        <NotEditable itemId={item.id} status={item.status} />
      </MarketplaceShell>
    );
  }

  return (
    <MarketplaceShell title="Edit Listing" contentWidth="detail" center>
      <ItemForm mode="edit" item={item} />
    </MarketplaceShell>
  );
}

/** Shown when an item can't be edited because it isn't AVAILABLE (Req 3.5). */
function NotEditable({ itemId, status }: { itemId: string; status: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">This listing can&apos;t be edited</CardTitle>
        <CardDescription>
          It&apos;s currently {status.toLowerCase()} and can only be modified
          while it is available.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link href={`/listings/${itemId}`}>Back to listing</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
