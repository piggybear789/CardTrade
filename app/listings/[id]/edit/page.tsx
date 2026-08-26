// app/listings/[id]/edit/page.tsx
//
// Edit-listing page (Req 3.4, 3.5, 3.7). A Server Component that:
//   - Redirects unauthenticated visitors to sign-in (Req 1.7).
//   - Loads the existing Item via `getItem` and prefills the client `ItemForm`.
//   - Enforces owner-only editing (Req 3.7): a non-owner (who may still see an
//     AVAILABLE item via RLS) gets a not-found response.
//   - Blocks editing of items that are not AVAILABLE (Req 3.5) with a message,
//     matching the guard the update action itself applies.

import { notFound, redirect } from "next/navigation";
import { Lock } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getItem } from "@/lib/actions/listings";
import { ItemForm } from "@/components/listings/ItemForm";
import { EmptyState } from "@/components/ui/empty-state";
import { MarketplaceShell } from "@/components/layout/MarketplaceShell";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

// Reads the authenticated user's session, so render dynamically.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Edit listing · NoDitto",
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
      <MarketplaceShell title="Edit Listing" center>
        <NotEditable itemId={item.id} status={item.status} />
      </MarketplaceShell>
    );
  }

  // Same canvas as the create flow, so the form renders identically in both
  // entry points.
  return (
    <MarketplaceShell title="Edit Listing">
      <ItemForm mode="edit" item={item} />
    </MarketplaceShell>
  );
}

/** Shown when an item can't be edited because it isn't AVAILABLE (Req 3.5). */
function NotEditable({ itemId, status }: { itemId: string; status: string }) {
  return (
    <EmptyState
      variant="page"
      icon={<Lock className="size-6" aria-hidden />}
      title="This listing can't be edited"
      titleAs="h3"
      description={`It's currently ${status.toLowerCase()} and can only be modified while it is available.`}
      action={{
        label: 'Back to listing',
        href: `/listings/${itemId}`,
        variant: 'outline',
        transitionTypes: ['nav-back'],
      }}
    />
  );
}
