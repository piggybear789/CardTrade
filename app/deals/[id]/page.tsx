// app/deals/[id]/page.tsx
//
// The deal room route. A Server Component that requires authentication, loads the
// deal through `getDeal` (which enforces the two-party participant guard under
// RLS - a non-participant sees no row and gets a 404), and renders the live
// client <DealRoom/>.

import { notFound, redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { getDeal } from '@/lib/actions/deals';
import { DealRoom } from '@/components/deals/DealRoom';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';

// Reads the authenticated user's session + live deal state.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Deal room · Poke-xchange',
  description: 'A private 1:1 binding deal between two members.',
};

export default async function DealPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: dealId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/sign-in?redirectTo=/deals/${dealId}`);
  }

  const result = await getDeal(dealId);
  if (!result.ok) {
    notFound();
  }

  // Same container as the cash sale contract room, so both read as one flow.
  return (
    <MarketplaceShell title="Deal Room" contentWidth="detail">
      <DealRoom view={result.view} myUserId={user.id} />
    </MarketplaceShell>
  );
}
