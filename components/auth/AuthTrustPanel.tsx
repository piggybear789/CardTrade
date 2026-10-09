// components/auth/AuthTrustPanel.tsx
//
// Three reasons to trust NoDitto, beside the sign-in and sign-up forms.
//
// The credential screens were a bare card on an empty page — the moment someone is
// asked for an account is the moment they ask what they are signing up to, and the
// page gave no answer. The same three mechanisms the guest catalog band names, each
// one enforced by the product.

import { HugeiconsIcon } from '@hugeicons/react';
import { LockIcon, ScaleIcon, ShieldCheckIcon } from '@hugeicons/core-free-icons';

const POINTS = [
  {
    icon: LockIcon,
    title: 'Payment held until you accept',
    body: 'Stripe holds a purchase until you have the card and say it is right.',
  },
  {
    icon: ShieldCheckIcon,
    title: 'Every seller ID-checked',
    body: 'Stripe checks a photo ID before anyone can list or trade.',
  },
  {
    icon: ScaleIcon,
    title: 'Disputes reviewed by people',
    body: 'Raise a problem and the money stays put while our case team looks.',
  },
] as const;

export function AuthTrustPanel() {
  return (
    <section aria-labelledby="auth-trust-heading" className="px-tight">
      <h2 id="auth-trust-heading" className="text-body font-semibold text-foreground">
        Why collectors trade on NoDitto
      </h2>
      <ul className="mt-cozy space-y-group">
        {POINTS.map((point) => (
          <li key={point.title} className="flex gap-cozy">
            <HugeiconsIcon icon={point.icon} className="mt-0.5 size-5 shrink-0 text-trust" aria-hidden />
            <div>
              <p className="text-body font-medium text-foreground">{point.title}</p>
              <p className="mt-0.5 text-pretty text-body text-muted-foreground">{point.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
