import 'server-only';

// lib/email/notify.ts
//
// High-level email notification dispatcher. Resolves the recipient's contact
// email from their profile and sends the appropriate template. Best-effort:
// a missing email or a failed send is logged and swallowed.
//
// THREADING. Every email carries a `threadId` derived from the contract type and
// id. All emails about the same contract land in one conversation thread in
// Gmail/Outlook/Apple Mail, preventing inbox spam on active contracts.
//
// Callers should NOT block on the result — fire and forget after the in-app
// notification, like this:
//   void emailNotify.disputeRaised({ ... });

import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from './sendEmail';
import * as templates from './templates';

/** Resolve a user's contact email and display name. */
async function resolveRecipient(
  userId: string,
): Promise<{ email: string; name: string } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('profiles')
    .select('contact_email, display_name')
    .eq('id', userId)
    .maybeSingle();
  if (!data?.contact_email) return null;
  return {
    email: data.contact_email as string,
    name: (data.display_name as string) ?? 'there',
  };
}

/** Build a deterministic thread ID from contract type and id. */
function threadFor(contractType: 'sale' | 'trade', contractId: string): string {
  return `${contractType}-${contractId}`;
}

export const emailNotify = {
  async inspectionDeadlineWarning(params: {
    userId: string;
    contractType: 'sale' | 'trade';
    contractId: string;
    hoursRemaining: number;
  }) {
    try {
      const recipient = await resolveRecipient(params.userId);
      if (!recipient) return;
      const template = templates.inspectionDeadlineWarning({
        recipientName: recipient.name,
        contractType: params.contractType,
        contractId: params.contractId,
        hoursRemaining: params.hoursRemaining,
      });
      await sendEmail({
        to: recipient.email,
        ...template,
        threadId: threadFor(params.contractType, params.contractId),
      });
    } catch (err) {
      console.warn('[email] inspectionDeadlineWarning failed:', err);
    }
  },

  async returnDeadlineWarning(params: {
    userId: string;
    contractId: string;
    hoursRemaining: number;
  }) {
    try {
      const recipient = await resolveRecipient(params.userId);
      if (!recipient) return;
      const template = templates.returnDeadlineWarning({
        recipientName: recipient.name,
        contractId: params.contractId,
        hoursRemaining: params.hoursRemaining,
      });
      await sendEmail({
        to: recipient.email,
        ...template,
        // Same thread as the rest of the sale, so the return sits in the conversation
        // the parties already have rather than starting a new one.
        threadId: threadFor('sale', params.contractId),
      });
    } catch (err) {
      console.warn('[email] returnDeadlineWarning failed:', err);
    }
  },

  async disputeRaised(params: {
    userId: string;
    contractType: 'sale' | 'trade';
    contractId: string;
  }) {
    try {
      const recipient = await resolveRecipient(params.userId);
      if (!recipient) return;
      const template = templates.disputeRaised({
        recipientName: recipient.name,
        contractType: params.contractType,
        contractId: params.contractId,
      });
      await sendEmail({
        to: recipient.email,
        ...template,
        threadId: threadFor(params.contractType, params.contractId),
      });
    } catch (err) {
      console.warn('[email] disputeRaised failed:', err);
    }
  },

  async payoutSettled(params: {
    userId: string;
    amountFormatted: string;
    contractId: string;
  }) {
    try {
      const recipient = await resolveRecipient(params.userId);
      if (!recipient) return;
      const template = templates.payoutSettled({
        recipientName: recipient.name,
        amountFormatted: params.amountFormatted,
        contractId: params.contractId,
      });
      await sendEmail({
        to: recipient.email,
        ...template,
        threadId: threadFor('sale', params.contractId),
      });
    } catch (err) {
      console.warn('[email] payoutSettled failed:', err);
    }
  },

  async newPurchaseRequest(params: {
    userId: string;
    itemTitle: string;
    contractId: string;
  }) {
    try {
      const recipient = await resolveRecipient(params.userId);
      if (!recipient) return;
      const template = templates.newPurchaseRequest({
        recipientName: recipient.name,
        itemTitle: params.itemTitle,
        contractId: params.contractId,
      });
      await sendEmail({
        to: recipient.email,
        ...template,
        threadId: threadFor('sale', params.contractId),
      });
    } catch (err) {
      console.warn('[email] newPurchaseRequest failed:', err);
    }
  },

  async tradeOfferReceived(params: { userId: string; contractId: string }) {
    try {
      const recipient = await resolveRecipient(params.userId);
      if (!recipient) return;
      const template = templates.tradeOfferReceived({
        recipientName: recipient.name,
        contractId: params.contractId,
      });
      await sendEmail({
        to: recipient.email,
        ...template,
        threadId: threadFor('trade', params.contractId),
      });
    } catch (err) {
      console.warn('[email] tradeOfferReceived failed:', err);
    }
  },

  async itemShipped(params: {
    userId: string;
    contractType: 'sale' | 'trade';
    contractId: string;
  }) {
    try {
      const recipient = await resolveRecipient(params.userId);
      if (!recipient) return;
      const template = templates.itemShipped({
        recipientName: recipient.name,
        contractType: params.contractType,
        contractId: params.contractId,
      });
      await sendEmail({
        to: recipient.email,
        ...template,
        threadId: threadFor(params.contractType, params.contractId),
      });
    } catch (err) {
      console.warn('[email] itemShipped failed:', err);
    }
  },
};
