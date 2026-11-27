// domain/references/paymentForensics.ts
//
// Proactive zero-cost payment-rail forensics designed to catch hijacked Facebook
// Marketplace accounts and money-mule PayID/bank transfers BEFORE Victim #1 ever pays.
//
// Checks:
//   1. Profile display name vs. PayID / Bank payee name mismatch (e.g. "Lynton Miller" on
//      Facebook asking you to PayID "sarah.nguyen94@gmail.com" or "John Citizen").
//   2. Disposable / throwaway email domain screening.
//   3. Australian BSB prefix bank resolution & invalid BSB detection.
//   4. Phone country/format consistency (foreign number claiming local AU meetup).
//   5. Free-provider / random-digit burner email heuristic.
//
// Pure: no network, React, or Supabase imports.

import type { ForensicsFlag } from '@/domain/references/profileForensics';

export interface PaymentForensicsReport {
  riskScore: number; // 0..100
  riskLevel: 'LOW' | 'ELEVATED' | 'HIGH';
  flags: ForensicsFlag[];
  bsbBankName: string | null;
  emailDomain: string | null;
  phoneRegionHint: string | null;
  nameComparison: {
    profileName: string;
    payeeLabel: string;
    matches: boolean;
  } | null;
}

/** Common disposable / temporary inbox domains used by burner scammers. */
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  '10minutemail.com',
  '10minutemail.net',
  'tempmail.com',
  'temp-mail.org',
  'yopmail.com',
  'yopmail.fr',
  'sharklasers.com',
  'trashmail.com',
  'throwawaymail.com',
  'dispostable.com',
  'getnada.com',
  'maildrop.cc',
  'fakeinbox.com',
  'mintemail.com',
  'burnermail.io',
  'emailondeck.com',
  'mohmal.com',
  'tempail.com',
]);

/** Major Australian BSB 2-digit / 3-digit institution prefixes (APCA directory). */
const AU_BSB_PREFIX_3: Record<string, string> = {
  '012': 'ANZ (NSW/ACT)',
  '013': 'ANZ (VIC)',
  '014': 'ANZ (QLD)',
  '015': 'ANZ (SA/NT)',
  '016': 'ANZ (WA)',
  '017': 'ANZ (TAS)',
  '032': 'Westpac (NSW/ACT)',
  '033': 'Westpac (VIC)',
  '034': 'Westpac (QLD)',
  '035': 'Westpac (SA/NT)',
  '036': 'Westpac (WA)',
  '037': 'Westpac (TAS)',
  '062': 'Commonwealth Bank (NSW/ACT)',
  '063': 'Commonwealth Bank (VIC)',
  '064': 'Commonwealth Bank (QLD)',
  '065': 'Commonwealth Bank (SA/NT)',
  '066': 'Commonwealth Bank (WA)',
  '067': 'Commonwealth Bank (TAS)',
  '082': 'NAB (NSW/ACT)',
  '083': 'NAB (VIC)',
  '084': 'NAB (QLD)',
  '085': 'NAB (SA/NT)',
  '086': 'NAB (WA)',
  '087': 'NAB (TAS)',
  '112': 'St.George Bank (NSW)',
  '113': 'Bank of Melbourne',
  '114': 'St.George Bank (QLD)',
  '182': 'Macquarie Bank',
  '302': 'Bankwest',
  '306': 'Bankwest (WA)',
  '484': 'Suncorp Bank',
  '633': 'Bendigo Bank',
  '732': 'Westpac / St.George',
  '802': 'Cuscal / Up / Neobank',
  '812': 'Bank Australia / Credit Union',
  '923': 'ING Australia',
  '944': 'ubank / 86 400',
  '774': 'Revolut / Wise / Fintech',
  '808': 'Wise Australia / Airwallex',
};

const AU_BSB_PREFIX_2: Record<string, string> = {
  '01': 'ANZ',
  '03': 'Westpac',
  '06': 'Commonwealth Bank (CBA)',
  '08': 'National Australia Bank (NAB)',
  '11': 'St.George / Bank of Melbourne',
  '12': 'Bank of Queensland (BOQ)',
  '18': 'Macquarie Bank',
  '30': 'Bankwest',
  '48': 'Suncorp Bank',
  '63': 'Bendigo / Adelaide Bank',
  '70': 'Mutual / Credit Union',
  '72': 'Mutual / Credit Union',
  '73': 'Westpac Group',
  '80': 'Cuscal / Neobank / Fintech',
  '81': 'Mutual Bank / Credit Union',
  '92': 'ING Australia',
  '94': 'ubank / Online Bank',
};

/** Resolve an Australian 6-digit BSB to its institution label. */
export function lookupAustralianBsbBank(rawBsbOrAccount: string): { bsb: string; bankName: string | null } | null {
  const digits = rawBsbOrAccount.replace(/\D/g, '');
  if (digits.length < 6) return null;
  const bsb = digits.slice(0, 6);
  const bankName = AU_BSB_PREFIX_3[bsb.slice(0, 3)] ?? AU_BSB_PREFIX_2[bsb.slice(0, 2)] ?? null;
  return { bsb, bankName };
}

/** Tokenize a person's name into lowercase alpha words (>= 2 chars). */
function nameTokens(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

/**
 * Checks whether a seller's profile display name overlaps meaningfully with the
 * PayID/bank account payee name they gave in Messenger.
 *
 * Returns `true` if any substantive token matches (including common nickname prefix
 * like `dave` <-> `david`, `chris` <-> `christopher`), or `false` on a clear mismatch
 * (e.g. `Lynton Miller` vs `Sarah Nguyen`).
 */
export function namesShareIdentity(profileName: string, payeeName: string): boolean {
  const a = nameTokens(profileName);
  const b = nameTokens(payeeName);
  if (a.length === 0 || b.length === 0) return true; // not enough info to flag

  for (const ta of a) {
    for (const tb of b) {
      if (ta === tb) return true;
      if (ta.length >= 3 && tb.length >= 3 && (ta.startsWith(tb.slice(0, 3)) || tb.startsWith(ta.slice(0, 3)))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Runs zero-cost proactive forensics on a seller's payment details (PayID email, phone,
 * BSB+account, crypto wallet) and optional PayID/bank payee name compared against their
 * profile display name.
 */
export function analyzePaymentRail(input: {
  paymentDetail?: string | null;
  payeeName?: string | null;
  profileName?: string | null;
  locationHint?: string | null;
}): PaymentForensicsReport {
  const detail = (input.paymentDetail ?? '').trim();
  const payeeName = (input.payeeName ?? '').trim();
  const profileName = (input.profileName ?? '').trim();
  const locationHint = (input.locationHint ?? '').trim().toLowerCase();

  const flags: ForensicsFlag[] = [];
  let bsbBankName: string | null = null;
  let emailDomain: string | null = null;
  let phoneRegionHint: string | null = null;
  let nameComparison: PaymentForensicsReport['nameComparison'] = null;

  // 1. Explicit Profile Name vs. Bank/PayID Account Holder Name comparison (HUGE hijacked-account catch!)
  if (profileName && payeeName && nameTokens(profileName).length >= 2 && nameTokens(payeeName).length >= 1) {
    const matches = namesShareIdentity(profileName, payeeName);
    nameComparison = { profileName, payeeLabel: payeeName, matches };
    if (!matches) {
      flags.push({
        code: 'PAYEE_NAME_MISMATCH',
        label: `Payment account name ("${payeeName}") does not match profile ("${profileName}")`,
        detail:
          'Hijacked accounts usually ask you to pay someone else’s bank or PayID. Paying a "partner" or "brother" account is a classic scam.',
        severity: 'HIGH',
        points: 45,
      });
    }
  }

  if (detail) {
    // 2. Email PayID / PayPal analysis
    const emailMatch = /^([^\s@]+)@([^\s@]+\.[^\s@]+)$/.exec(detail.toLowerCase());
    if (emailMatch) {
      const localPart = emailMatch[1]!;
      emailDomain = emailMatch[2]!;

      if (DISPOSABLE_EMAIL_DOMAINS.has(emailDomain)) {
        flags.push({
          code: 'DISPOSABLE_PAYMENT_EMAIL',
          label: `Disposable / throwaway email domain (${emailDomain})`,
          detail: 'This is a disposable email address. Real sellers don’t use one for payouts.',
          severity: 'HIGH',
          points: 45,
        });
      }

      if (/\d{5,}$/.test(localPart)) {
        flags.push({
          code: 'BURNER_EMAIL_DIGITS',
          label: 'Email local part has a long random digit suffix',
          detail: `Email starts with "${localPart.slice(0, 4)}…" ending in 5+ digits, often seen on newly created throwaway accounts.`,
          severity: 'CAUTION',
          points: 15,
        });
      }

      // If no explicit payeeName was entered, check if email local part clearly embeds a totally different full name (first.last@...)
      if (!nameComparison && profileName && nameTokens(profileName).length >= 2) {
        const localWords = localPart
          .replace(/\d+/g, ' ')
          .split(/[._-]+/)
          .filter((w) => w.length >= 3 && !['cards', 'tcg', 'poke', 'pokemon', 'shop', 'store', 'sales', 'deals', 'trade', 'payid', 'paypal', 'collects', 'official', 'mail', 'gmail'].includes(w));
        if (localWords.length >= 2) {
          const inferredLabel = localWords.slice(0, 2).join(' ');
          const matches = namesShareIdentity(profileName, inferredLabel);
          if (!matches) {
            nameComparison = { profileName, payeeLabel: inferredLabel, matches: false };
            flags.push({
              code: 'EMAIL_NAME_MISMATCH',
              label: `PayID/PayPal email name ("${inferredLabel}") differs from profile ("${profileName}")`,
              detail:
                'The email address appears to belong to a different person than the profile you are messaging. Confirm the verified PayID name in your banking app before confirming transfer.',
              severity: 'CAUTION',
              points: 25,
            });
          }
        }
      }
    }

    // 3. Crypto wallet check
    if (/^(?:0x[a-fA-F0-9]{20,}|(?:bc1|[13])[a-zA-Z0-9]{24,})$/.test(detail) && !/\s/.test(detail)) {
      flags.push({
        code: 'IRREVERSIBLE_CRYPTO_PAYMENT',
        label: 'Irreversible crypto wallet requested',
        detail: 'Crypto transfers carry zero buyer protection or chargeback recourse and are heavily favoured by off-platform scammers.',
        severity: 'HIGH',
        points: 35,
      });
    }

    // 4. Australian BSB + Account check (when formatted like 062-000 12345678 and not a phone)
    const digits = detail.replace(/\D/g, '');
    const looksLikePhone =
      detail.startsWith('+') ||
      digits.startsWith('04') ||
      digits.startsWith('614') ||
      digits.length === 9;

    if (!emailMatch && !looksLikePhone && digits.length >= 10 && digits.length <= 16) {
      const bsbInfo = lookupAustralianBsbBank(digits);
      if (bsbInfo) {
        bsbBankName = bsbInfo.bankName;
        if (!bsbInfo.bankName) {
          flags.push({
            code: 'UNRECOGNISED_AU_BSB',
            label: `Unrecognised Australian BSB prefix (${bsbInfo.bsb.slice(0, 3)}-***)`,
            detail: 'This BSB prefix does not match a major Australian retail bank. Double-check the bank details before transferring.',
            severity: 'CAUTION',
            points: 18,
          });
        } else if (/Fintech|Neobank|Revolut|Wise/i.test(bsbInfo.bankName)) {
          flags.push({
            code: 'FINTECH_NEOBANK_RAIL',
            label: `Online fintech / neobank rail (${bsbInfo.bankName})`,
            detail: 'Virtual/fintech BSBs are commonly used by offshore or throwaway accounts because they are fast to spin up. Verify the account name matches the seller.',
            severity: 'INFO',
            points: 8,
          });
        }
      }
    } else if (!emailMatch && looksLikePhone && digits.length >= 9 && digits.length <= 15) {
      if (digits.startsWith('614') || digits.startsWith('04')) {
        phoneRegionHint = 'Australia mobile (+61)';
      } else if (digits.startsWith('64')) {
        phoneRegionHint = 'New Zealand (+64)';
      } else if (digits.startsWith('44')) {
        phoneRegionHint = 'United Kingdom (+44)';
      } else if (digits.startsWith('1') && digits.length === 11) {
        phoneRegionHint = 'US / Canada (+1)';
      } else if (detail.startsWith('+')) {
        phoneRegionHint = `International (+${digits.slice(0, 2)}…)`;
      }

      const expectsAustralia =
        /\b(au|australia|melbourne|sydney|brisbane|perth|adelaide|canberra|hobart|darwin|gold\s*coast|nsw|vic|qld|wa|sa)\b/i.test(
          locationHint,
        );
      if (expectsAustralia && phoneRegionHint && !phoneRegionHint.startsWith('Australia')) {
        flags.push({
          code: 'PHONE_LOCATION_MISMATCH',
          label: `Non-Australian phone (${phoneRegionHint}) for Australian listing`,
          detail: `Listing/context says "${input.locationHint}" but the seller gave a ${phoneRegionHint} phone number.`,
          severity: 'HIGH',
          points: 45,
        });
      }
    }
  }

  const riskScore = Math.min(
    100,
    flags.reduce((sum, f) => sum + f.points, 0),
  );
  const riskLevel = riskScore >= 45 ? 'HIGH' : riskScore >= 20 ? 'ELEVATED' : 'LOW';

  return {
    riskScore,
    riskLevel,
    flags,
    bsbBankName,
    emailDomain,
    phoneRegionHint,
    nameComparison,
  };
}
