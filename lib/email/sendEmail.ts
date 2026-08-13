import 'server-only';

// lib/email/sendEmail.ts
//
// Thin, best-effort email sender over AWS SES v2. Mirrors createNotification's
// contract: never throw into the caller's happy path. A failed send is logged
// and swallowed.
//
// THREADING. Every email about a contract carries a deterministic Message-ID
// based on the contract type and id, and references the thread root. Email
// clients (Gmail, Outlook, Apple Mail) collapse all emails with the same
// References header into one conversation. This prevents a contract with 6
// lifecycle events from showing as 6 separate inbox items.
//
// Environment:
//   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY — IAM user or role credentials
//   AWS_SES_REGION — SES region (defaults to ap-southeast-2)
//   EMAIL_FROM — verified sender (defaults to notifications@noditto.app)

import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { getSESClient } from './ses';

const FROM_ADDRESS = process.env.EMAIL_FROM ?? 'NoDitto <notifications@noditto.app>';
const DOMAIN = 'noditto.app';

export interface SendEmailInput {
  to: string;
  subject: string;
  /** Plain-text body. */
  text: string;
  /** Optional HTML body. When omitted, `text` is sent as-is. */
  html?: string;
  /**
   * Thread identifier for email conversation grouping. All emails with the
   * same threadId are grouped into one conversation in the recipient's inbox.
   * Format: `sale-{id}` or `trade-{id}`.
   */
  threadId?: string;
}

/**
 * Build a raw MIME message with threading headers.
 */
function buildRawMessage(input: SendEmailInput): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const messageId = input.threadId
    ? `<${input.threadId}-${Date.now()}@${DOMAIN}>`
    : `<${Date.now()}-${Math.random().toString(36).slice(2)}@${DOMAIN}>`;
  const threadRoot = input.threadId ? `<${input.threadId}@${DOMAIN}>` : null;

  const headers = [
    `From: ${FROM_ADDRESS}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    `Message-ID: ${messageId}`,
    ...(threadRoot
      ? [
          `References: ${threadRoot}`,
          `In-Reply-To: ${threadRoot}`,
        ]
      : []),
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '', // end of headers
  ];

  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    // 8bit, NOT 7bit. The templates contain em- and en-dashes, which are multi-byte
    // in UTF-8, and `TextEncoder` below emits those octets as-is. Declaring 7bit
    // (all octets 0-127, per RFC 2045 §2.7) while sending bytes above 127 is a lie
    // a strict relay in the delivery chain may reject or mangle. SES accepts 8bit.
    'Content-Transfer-Encoding: 8bit',
    '',
    input.text,
  ];

  if (input.html) {
    parts.push(
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      input.html,
    );
  }

  parts.push(`--${boundary}--`);

  return [...headers, ...parts].join('\r\n');
}

/**
 * Send a transactional email via AWS SES v2. Best-effort: returns true on
 * success, false on any failure, never throws.
 *
 * Uses SendRawEmail to include threading headers (References, In-Reply-To)
 * that group all emails about the same contract into one conversation.
 */
export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  try {
    const client = getSESClient();
    if (!client) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[email] skipped (no SES client):', input.subject, '->', input.to);
      }
      return false;
    }

    const rawMessage = buildRawMessage(input);

    const command = new SendEmailCommand({
      Content: {
        Raw: { Data: new TextEncoder().encode(rawMessage) },
      },
    });

    await client.send(command);
    return true;
  } catch (e) {
    console.error('[email] SES send failed:', e);
    return false;
  }
}
