// app/purchases/page.tsx
//
// Purchases: every Cash_Sale where the caller is the buyer (Req 4). Promoted to
// a first-class workspace section so a buyer can reach a live contract room in
// one click instead of digging through an account tab.

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { getMyPurchases } from '@/lib/actions/account';
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
  title: 'Purchases · CardTrade',
  description: 'Contracts where you are the buyer.',
};

export default async function PurchasesPage({
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
    redirect('/sign-in?redirectTo=/purchases');
  }

  const result = await getMyPurchases();
  const { active, past } = partitionByScope(result.ok ? result.data : [], (sale) =>
    isCashSalePast(sale.status),
  );

  return (
    <MarketplaceShell title="Purchases" contentWidth="reading">
      <SectionHeader
        title="Purchases"
        description="Items you are buying. Open a contract to agree terms, pay, and confirm handover."
      />
      <SectionFilter
        scope={scope}
        basePath="/purchases"
        activeCount={active.length}
        pastCount={past.length}
      />
      {result.ok ? (
        <CashSalesSection
          sales={scope === 'past' ? past : active}
          variant="purchases"
        />
      ) : (
        <SectionLoadError label="purchases" />
      )}
    </MarketplaceShell>
  );
}
