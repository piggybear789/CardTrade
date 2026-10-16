// components/auth/AuthTrustPanel.tsx
//
// Three reasons to trust NoDitto, beside the sign-in and sign-up forms.
//
// The credential screens were a bare card on an empty page — the moment someone is
// asked for an account is the moment they ask what they are signing up to, and the
// page gave no answer. The same three mechanisms the guest catalog band names, each
// one enforced by the product.
//
// ONE CONFIDENT SURFACE, modelled on the strongest auth panels on Mobbin (YNAB,
// Airtable, Hootsuite): a deep brand colour with light text, a real headline, small
// single-colour icons centred on their point, and a quiet proof line
// at the foot. A pale wash was tried first and read as unfinished. Obsidian is the
// header's own colour, so the panel reads as part of the chrome rather than a sticker,
// and the iris accent is used only on non-text marks (it is a non-text colour).

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
    <section
      aria-labelledby="auth-trust-heading"
      className="relative flex h-full flex-col overflow-hidden rounded-lg bg-obsidian p-section text-mist"
    >
      {/* One soft iris arc in the corner for depth. Decorative, behind the text, and
          clipped by the panel, so it never sits under a word. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 size-64 rounded-full bg-iris/25 blur-2xl"
      />

      <div className="relative flex flex-1 flex-col justify-center">
        <p className="text-meta font-medium uppercase tracking-wide text-mist/70">
          Why Trade on NoDitto
        </p>
        <h2
          id="auth-trust-heading"
          className="mt-snug text-balance text-head font-semibold leading-tight text-white"
        >
          Trade cards without trusting strangers.
        </h2>

        <ul className="mt-section space-y-group">
          {POINTS.map((point) => (
            <li key={point.title} className="flex items-center gap-cozy">
              {/* A fixed 2rem badge, centred on the whole title-plus-body block. Pinning
                  it to the title line left it straddling the title and the body's first
                  line, which read as misaligned against both. */}
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-white/10 ring-1 ring-inset ring-white/10">
                <HugeiconsIcon icon={point.icon} className="size-4 text-iris" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-body font-semibold text-white">{point.title}</p>
                <p className="mt-0.5 text-pretty text-body text-mist/75">{point.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative mt-section border-t border-white/10 pt-cozy text-meta text-mist/60">
        Payments and ID checks by Stripe.
      </p>
    </section>
  );
}
