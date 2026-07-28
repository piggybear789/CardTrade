// app/sales/page.tsx
//
// Sales: every Cash_Sale where the caller is the seller (Req 4). Sits directly
// above the contract rooms it links to at /sales/[id].

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { getMySales } from '@/lib/actions/account';
import { CashSalesSection } from '@/components/account/CashSalesSection';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { SectionHeader, SectionLoadError } from '@/components/layout/SectionHeader';
import {
  SectionFilter,
  partitionByScope,
  resolveScope,
} from '@/components/layout/SectionFilter';
import { isCashSalePast } from '@/lib/lifecycle';

// Reads the caller's session and live contract state.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Sales · Poke-xchange',
  description: 'Contracts where you are the seller.',
};

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string | string[] }>;
}) {
  const { show } = await searchParams;
  const scope = resolveScope(show);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?redirectTo=/sales');
  }

  const result = await getMySales();
  const { active, past } = partitionByScope(result.ok ? result.data : [], (sale) =>
    isCashSalePast(sale.status),
  );

  return (
    <MarketplaceShell title="Sales">
      <SectionHeader
        title="Sales"
        description="Items you are selling. Open a contract to set terms, ship, and get paid."
      />
      <SectionFilter
        scope={scope}
        basePath="/sales"
        activeCount={active.length}
        pastCount={past.length}
      />
      {result.ok ? (
        <CashSalesSection sales={scope === 'past' ? past : active} variant="sales" />
      ) : (
        <SectionLoadError label="sales" />
      )}
    </MarketplaceShell>
  );
}
