import { redirect } from 'next/navigation';

export default async function PayoutsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ show?: string | string[] }>;
}) {
  const { show } = await searchParams;
  const raw = Array.isArray(show) ? show[0] : show;
  const params = new URLSearchParams({ tab: 'payouts' });
  if (raw === 'past') params.set('show', 'past');
  redirect(`/profile?${params.toString()}`);
}
