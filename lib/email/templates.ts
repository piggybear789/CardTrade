import 'server-only';

// lib/email/templates.ts
//
// Plain-text email templates for transactional notifications. Each function
// returns { subject, text, html } ready for sendEmail. HTML is minimal and
// inline-styled for email client compatibility.

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://noditto.app';
const BRAND = 'NoDitto';

function wrap(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0c0b0a;padding:24px;max-width:560px;margin:0 auto;">
${body}
<hr style="border:none;border-top:1px solid #e5e5e5;margin:32px 0 16px;">
<p style="font-size:12px;color:#666;">This is an automated message from ${BRAND}. Do not reply to this email.</p>
</body>
</html>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;padding:12px 24px;background:#0c0b0a;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">${label}</a>`;
}

export function inspectionDeadlineWarning(params: {
  recipientName: string;
  contractType: 'sale' | 'trade';
  contractId: string;
  hoursRemaining: number;
}) {
  const link = `${SITE_URL}/${params.contractType === 'sale' ? 'sales' : 'trades'}/${params.contractId}`;
  const subject = `Action needed: ${params.hoursRemaining}h left to inspect your ${params.contractType === 'sale' ? 'purchase' : 'trade'}`;
  const text = `Hi ${params.recipientName},\n\nYour inspection window closes in ${params.hoursRemaining} hours. If you don't respond, the ${params.contractType} will auto-complete.\n\nReview it here: ${link}\n\n— ${BRAND}`;
  const html = wrap(`
<h2 style="font-size:20px;margin:0 0 16px;">Inspection closing soon</h2>
<p>Hi ${params.recipientName},</p>
<p>Your inspection window closes in <strong>${params.hoursRemaining} hours</strong>. If you don't respond, the ${params.contractType} will auto-complete and funds will be released.</p>
<p style="margin:24px 0;">${button(link, 'Review now')}</p>
<p style="font-size:13px;color:#666;">If you're satisfied with what you received, you can ${params.contractType === 'sale' ? 'complete the purchase' : 'accept'} early to release funds sooner.</p>`);
  return { subject, text, html };
}

/**
 * Nudge the Buyer before the RETURN dispatch deadline (0088).
 *
 * Deliberately does NOT say the refund will be lost, because it will not be — a lapsed
 * return goes to a human rather than being settled on a timer (0089). Overstating the
 * consequence to force action would be a lie told for convenience.
 */
export function returnDeadlineWarning(params: {
  recipientName: string;
  contractId: string;
  hoursRemaining: number;
}) {
  const link = `${SITE_URL}/sales/${params.contractId}`;
  const subject = `Action needed: ${params.hoursRemaining}h to post your return`;
  const text = `Hi ${params.recipientName},\n\nYour refund is waiting on the item coming back. Please post it and add the tracking number within ${params.hoursRemaining} hours.\n\nIf you miss the deadline our team reviews the case rather than closing it automatically, but it will take longer to resolve.\n\nAdd tracking here: ${link}\n\n— ${BRAND}`;
  const html = wrap(`
<h2 style="font-size:20px;margin:0 0 16px;">Post your return soon</h2>
<p>Hi ${params.recipientName},</p>
<p>Your refund is waiting on the item coming back. Please post it and add the tracking number within <strong>${params.hoursRemaining} hours</strong>.</p>
<p style="margin:24px 0;">${button(link, 'Add return tracking')}</p>
<p style="font-size:13px;color:#666;">Your refund is released automatically once the carrier confirms it arrived. If you miss the deadline our team reviews the case rather than closing it automatically.</p>`);
  return { subject, text, html };
}

export function disputeRaised(params: {
  recipientName: string;
  contractType: 'sale' | 'trade';
  contractId: string;
}) {
  const link = `${SITE_URL}/${params.contractType === 'sale' ? 'sales' : 'trades'}/${params.contractId}`;
  const subject = `A dispute was raised on your ${params.contractType}`;
  const text = `Hi ${params.recipientName},\n\nThe other party raised a dispute on your ${params.contractType}. Funds are frozen while NoDitto support reviews it.\n\nView and respond: ${link}\n\n— ${BRAND}`;
  const html = wrap(`
<h2 style="font-size:20px;margin:0 0 16px;">Dispute raised</h2>
<p>Hi ${params.recipientName},</p>
<p>The other party raised a dispute on your ${params.contractType}. All funds are frozen while NoDitto support reviews it.</p>
<p>You can submit your side of the story with evidence.</p>
<p style="margin:24px 0;">${button(link, 'View dispute')}</p>`);
  return { subject, text, html };
}

export function payoutSettled(params: {
  recipientName: string;
  amountFormatted: string;
  contractId: string;
}) {
  const link = `${SITE_URL}/sales/${params.contractId}`;
  const subject = `You were paid ${params.amountFormatted}`;
  const text = `Hi ${params.recipientName},\n\nYour payout of ${params.amountFormatted} has been sent to your bank account. It should arrive in 1-2 business days.\n\nView details: ${link}\n\n— ${BRAND}`;
  const html = wrap(`
<h2 style="font-size:20px;margin:0 0 16px;">Payout sent</h2>
<p>Hi ${params.recipientName},</p>
<p>Your payout of <strong>${params.amountFormatted}</strong> has been sent to your bank account. It should arrive in 1–2 business days.</p>
<p style="margin:24px 0;">${button(link, 'View details')}</p>`);
  return { subject, text, html };
}

export function newPurchaseRequest(params: {
  recipientName: string;
  itemTitle: string;
  contractId: string;
}) {
  const link = `${SITE_URL}/sales/${params.contractId}`;
  const subject = `New purchase request for "${params.itemTitle}"`;
  const text = `Hi ${params.recipientName},\n\nA buyer wants to purchase "${params.itemTitle}" from your listing.\n\nReview it: ${link}\n\n— ${BRAND}`;
  const html = wrap(`
<h2 style="font-size:20px;margin:0 0 16px;">New purchase request</h2>
<p>Hi ${params.recipientName},</p>
<p>A buyer wants to purchase <strong>"${params.itemTitle}"</strong> from your listing.</p>
<p style="margin:24px 0;">${button(link, 'Review request')}</p>`);
  return { subject, text, html };
}

export function tradeOfferReceived(params: {
  recipientName: string;
  contractId: string;
}) {
  const link = `${SITE_URL}/trades/${params.contractId}`;
  const subject = 'You received a trade offer';
  const text = `Hi ${params.recipientName},\n\nSomeone wants to trade with you. Review their offer and respond.\n\nView offer: ${link}\n\n— ${BRAND}`;
  const html = wrap(`
<h2 style="font-size:20px;margin:0 0 16px;">Trade offer received</h2>
<p>Hi ${params.recipientName},</p>
<p>Someone wants to trade with you. Review their offer and respond.</p>
<p style="margin:24px 0;">${button(link, 'View offer')}</p>`);
  return { subject, text, html };
}

export function itemShipped(params: {
  recipientName: string;
  contractType: 'sale' | 'trade';
  contractId: string;
}) {
  const link = `${SITE_URL}/${params.contractType === 'sale' ? 'sales' : 'trades'}/${params.contractId}`;
  const subject = `Your ${params.contractType === 'sale' ? 'purchase' : 'trade item'} has been shipped`;
  const text = `Hi ${params.recipientName},\n\nThe other party marked the item as shipped. Watch for delivery.\n\nView details: ${link}\n\n— ${BRAND}`;
  const html = wrap(`
<h2 style="font-size:20px;margin:0 0 16px;">Item shipped</h2>
<p>Hi ${params.recipientName},</p>
<p>The other party marked the item as shipped. Watch for delivery and inspect it when it arrives.</p>
<p style="margin:24px 0;">${button(link, 'View details')}</p>`);
  return { subject, text, html };
}
