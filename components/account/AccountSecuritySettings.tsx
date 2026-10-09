'use client';

// components/account/AccountSecuritySettings.tsx
//
// Email and Security, on the Account hub's Profile tab.
//
// Account had no security or notification settings at all: no way to change a
// password while signed in, to see which address signs you in, to end a session on a
// device you no longer have, or to stop a kind of email. These are the same settings
// rows as the rest of the tab, with a switch or a button where the chevron would be.
//
// PASSWORD BY EMAILED LINK, NOT A FORM HERE. Setting a new password from a signed-in
// session with no proof of the old one would let anyone holding an unlocked device
// take the account; the reset link proves control of the inbox, and it is the same
// flow a forgotten password already uses.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { LockPasswordIcon, Logout01Icon, Mail01Icon } from '@hugeicons/core-free-icons';

import { requestPasswordReset, signOutEverywhere } from '@/lib/actions/auth';
import { setEmailPreference, type EmailPreference } from '@/lib/actions/profile';
import { SettingsGroup, SettingsListRow } from '@/components/account/SettingsPrimitives';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Switch } from '@/components/ui/switch';

const EMAIL_ROWS: { key: EmailPreference; label: string; description: string }[] = [
  {
    key: 'email_deal_requests',
    label: 'Purchase requests and trade offers',
    description: 'When someone wants to buy or trade for your card.',
  },
  {
    key: 'email_shipping_updates',
    label: 'Shipping updates',
    description: 'When the other party posts an item to you.',
  },
  {
    key: 'email_payouts',
    label: 'Payouts',
    description: 'When money from a sale reaches your bank.',
  },
];

export function AccountSecuritySettings({
  signInEmail,
  emailPreferences,
}: {
  /** The address the member signs in with (`auth.users.email`). */
  signInEmail: string | null;
  emailPreferences: Record<EmailPreference, boolean>;
}) {
  const router = useRouter();
  const [prefs, setPrefs] = useState(emailPreferences);
  const [, startTransition] = useTransition();
  const [resetPending, startReset] = useTransition();
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutPending, startSignOut] = useTransition();

  function toggle(key: EmailPreference, enabled: boolean) {
    setPrefs((current) => ({ ...current, [key]: enabled }));
    startTransition(async () => {
      const result = await setEmailPreference(key, enabled);
      if (!result.ok) {
        setPrefs((current) => ({ ...current, [key]: !enabled }));
        toast.error(result.message);
      }
    });
  }

  function sendResetLink() {
    if (!signInEmail) return;
    startReset(async () => {
      const result = await requestPasswordReset(signInEmail);
      if (result.ok) toast.success(`We sent a link to ${signInEmail}.`);
      else toast.error(result.message);
    });
  }

  function endAllSessions() {
    startSignOut(async () => {
      const result = await signOutEverywhere();
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      router.push('/sign-in');
      router.refresh();
    });
  }

  return (
    <>
      <SettingsGroup label="Email">
        {EMAIL_ROWS.map((row) => (
          <SettingsListRow
            key={row.key}
            label={<label htmlFor={`email-pref-${row.key}`}>{row.label}</label>}
            description={row.description}
            trailing={
              <Switch
                id={`email-pref-${row.key}`}
                checked={prefs[row.key]}
                onCheckedChange={(checked) => toggle(row.key, checked)}
              />
            }
          />
        ))}
        {/* NOT A SWITCH, deliberately: missing a deadline or a dispute can cost a member
            their protection or their money, so these send regardless. Saying so here
            answers "why do I still get these?" before it is asked. */}
        <SettingsListRow
          icon={Mail01Icon}
          label="Deadlines and disputes"
          description="Always sent, so you never miss a window that protects you."
        />
      </SettingsGroup>

      <SettingsGroup label="Security">
        <SettingsListRow label="Sign-in email" value={signInEmail ?? 'Not available'} />
        <SettingsListRow
          icon={LockPasswordIcon}
          label="Password"
          description="We email you a link to set a new one."
          trailing={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={sendResetLink}
              disabled={resetPending || !signInEmail}
              aria-busy={resetPending}
            >
              Send link
            </Button>
          }
        />
        <SettingsListRow
          icon={Logout01Icon}
          label="Sign out everywhere"
          description="Ends every session, on every device, including this one."
          trailing={
            <Button type="button" variant="outline" size="sm" onClick={() => setSignOutOpen(true)}>
              Sign out
            </Button>
          }
        />
      </SettingsGroup>

      <ConfirmDialog
        open={signOutOpen}
        onOpenChange={setSignOutOpen}
        title="Sign out everywhere?"
        description="Every device signed in to your account will be signed out, including this one. You can sign back in with your password or Google."
        confirmLabel="Sign out everywhere"
        cancelLabel="Stay signed in"
        onConfirm={endAllSessions}
        pending={signOutPending}
      />
    </>
  );
}
