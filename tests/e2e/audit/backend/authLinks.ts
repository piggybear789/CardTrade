// tests/e2e/audit/backend/authLinks.ts
//
// EMAIL LINKS WITHOUT AN INBOX for the e2e UX audit suite: a password-reset link and
// a sign-up confirmation link, generated through the Supabase Auth Admin API and
// pointed at the App_Server's own `/auth/confirm` route.
//
// Requirements:
//   7.6  a reset completed through an Admin-generated link: the new password signs
//        in and the old one is refused
//   7.7  a confirmation completed through an Admin-generated link: `/auth/confirm`
//        signs the member in
//   2.1  only Sandbox_Accounts (enforced by `generateAuthLink`)
//
// WHY THE LINK IS BUILT HERE rather than following GoTrue's `action_link`. The app
// uses the PKCE flow, so its email templates point at `/auth/confirm?token_hash=…&type=…`
// and that route redeems the hash with `verifyOtp` and sets the session as cookies
// (`app/auth/confirm/route.ts`). GoTrue's own verify URL returns the session in a URL
// fragment instead, which never reaches the server. Building the template's URL from
// the hashed token exercises the same route a member's email would.
//
// A generated link is a credential for that account until it is used. Pass it to a
// page; never log it or attach it to a report.

import { generateAuthLink, type AuthLink } from '../../support/db';
import { appServerUrl, type AppServer } from '../../support/users';

/** The App_Server route that redeems an emailed link (`app/auth/confirm/route.ts`). */
const CONFIRM_PATH = '/auth/confirm';

/** An emailed link as the member would click it. Secret-bearing. */
export interface EmailLink {
  /** `http://localhost:<port>/auth/confirm?token_hash=…&type=…`. */
  url: string;
  /** The OTP type the route passes to `verifyOtp`. */
  type: string;
}

/**
 * The `/auth/confirm` URL for a generated link on an App_Server. Pure. `next`, when
 * given, must be a same-origin path; the route ignores anything else.
 */
export function confirmUrl(link: Pick<AuthLink, 'hashedToken' | 'verificationType'>, server: AppServer = 'main', next?: string): string {
  const url = new URL(CONFIRM_PATH, appServerUrl(server));
  url.searchParams.set('token_hash', link.hashedToken);
  url.searchParams.set('type', link.verificationType);
  if (next) url.searchParams.set('next', next);
  return url.toString();
}

/**
 * A password-reset link for a Sandbox_Account. Redeeming it lands on
 * `/auth/update-password` with a recovery session.
 */
export async function passwordResetLink(userId: string, opts: { server?: AppServer } = {}): Promise<EmailLink> {
  const link = await generateAuthLink('recovery', userId);
  return { url: confirmUrl(link, opts.server), type: link.verificationType };
}

/**
 * A sign-up confirmation link for an unconfirmed Sandbox_Account. GoTrue needs the
 * account's password for this link type. Redeeming it confirms the email, signs the
 * member in and lands on `/onboarding`.
 */
export async function confirmationLink(
  userId: string,
  password: string,
  opts: { server?: AppServer } = {},
): Promise<EmailLink> {
  const link = await generateAuthLink('signup', userId, { password });
  return { url: confirmUrl(link, opts.server), type: link.verificationType };
}
