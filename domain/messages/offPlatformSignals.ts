// domain/messages/offPlatformSignals.ts
//
// ESC-27: spot a message trying to move a deal off the platform.
//
// The escrow only protects money that goes through it. The commonest way round it is
// a chat message: "pay me on PayID", "text me on 04..", "PayPal friends and family".
// Nothing here BLOCKS a message; a false positive must cost nothing more than a
// warning. So the patterns are conservative: card numbers, set codes ("SV01-123"),
// prices and grading serials must not match.
//
// Pure, so the server action and the tests share it.

/** One kind of off-platform lure. */
export type OffPlatformSignal =
  | 'PAYMENT_RAIL'
  | 'PHONE_NUMBER'
  | 'EMAIL_ADDRESS'
  | 'MESSAGING_APP'
  | 'BANK_DETAILS';

const PATTERNS: ReadonlyArray<[OffPlatformSignal, RegExp]> = [
  ['PAYMENT_RAIL', /\b(pay\s?id|osko|paypal|venmo|zelle|cash\s?app|revolut|wise\.com|friends\s*(and|&)\s*family|f\s?&\s?f|bank\s+transfer|direct\s+deposit|crypto|usdt|bitcoin|btc)\b/i],
  // Australian mobiles (04xx xxx xxx / +61 4xx) and generic international numbers
  // with a leading +. Bare digit runs are NOT matched: card numbers and serials.
  ['PHONE_NUMBER', /(\+61\s?4\d{2}[\s-]?\d{3}[\s-]?\d{3}\b|\b04\d{2}[\s-]?\d{3}[\s-]?\d{3}\b|\+\d{1,3}[\s-]?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}\b)/],
  ['EMAIL_ADDRESS', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ['MESSAGING_APP', /\b(whats\s?app|telegram|signal\s+me|wechat|snapchat|insta(gram)?\s+dm|dm\s+me\s+on|text\s+me)\b/i],
  ['BANK_DETAILS', /\b(bsb\s*[:#-]?\s*\d{3}[\s-]?\d{3}|account\s*(no|number|#)\s*[:#-]?\s*\d{6,})\b/i],
];

/**
 * The off-platform signals in one message body, deduplicated, in a stable order.
 * Empty for an ordinary message.
 */
export function offPlatformSignals(body: string | null | undefined): OffPlatformSignal[] {
  if (!body) return [];
  const text = body.slice(0, 8_000);
  return PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([signal]) => signal);
}
