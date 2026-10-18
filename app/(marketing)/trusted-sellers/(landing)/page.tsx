import { redirect } from 'next/navigation';

// app/(marketing)/trusted-sellers/(landing)/page.tsx
//
// The Trusted Sellers directory landing was replaced by References (0155):
// a search bar over the public trust graph. This route now redirects there.
// The Trusted Seller programme itself (application, badge, admin review)
// still lives at /trusted-sellers/apply and in the admin console.

export default function TrustedSellersLandingRedirect() {
  redirect('/references');
}
