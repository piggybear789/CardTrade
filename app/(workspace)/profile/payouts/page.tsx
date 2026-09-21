import { redirect } from 'next/navigation';

// app/(workspace)/profile/payouts/page.tsx
//
// The retired Payouts page, kept as a redirect so old links keep working. Payouts is a
// TAB of the Account hub now, and setup lives under Verification.
//
// STRIPE STILL SENDS PEOPLE HERE. Identity sessions opened when `/profile/payouts` was
// the default return path carry that URL for life — a VerificationSession's
// `return_url` cannot be changed, and the binding resumes sessions rather than opening
// new ones. This redirect used to keep only `show`, so a member finishing one of those
// checks landed on the Payouts tab with the `identity=complete` marker gone: the wrong
// tab, and nothing there to reconcile the result. Every parameter is forwarded now, and
// a return marker sends the member to the tab that owns the step it belongs to.
export default async function PayoutsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const incoming = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(incoming)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) params.set(key, first);
  }

  // A hosted-flow return belongs on Verification: that is where the two-step
  // sequence, its reconcilers and its "confirming with Stripe" state live. Anything
  // else is a bookmark to the reporting tab.
  const returningFromProvider = params.has('identity') || params.has('payouts');
  params.set('tab', returningFromProvider ? 'verification' : 'payouts');

  redirect(`/profile?${params.toString()}`);
}
