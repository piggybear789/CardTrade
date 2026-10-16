# Requirements: Scam reports (off-platform)

**Status: built, always on.** Legal review of privacy and defamation is still
recommended. See Requirement 10.

## Introduction

Scams in the card hobby mostly happen outside any marketplace: a deal agreed over
Instagram DMs, paid by bank transfer or PayPal Friends and Family, and never shipped.
NoDitto cannot adjudicate those deals, but the same scammers reappear, and they
reappear with the same **payment details**. A PayID or a bank account reported by two
unrelated people is a strong signal, and it is one NoDitto can check new members
against before they cost anyone money here.

This feature lets ID-verified members report a scam that happened off NoDitto, stores
the payment details as one-way fingerprints, groups independent reports that share a
fingerprint, and flags matching NoDitto members **to staff**. It never publishes an
accusation, never acts automatically on off-platform evidence alone, and lets the
person flagged respond.

### Facts this design depends on

Checked against the code, not assumed:

- NoDitto already fingerprints sensitive identifiers with HMAC-SHA256 and never stores
  the raw value: card and payout-account fingerprints (`domain/risk/relatedAccounts.ts`,
  `member_risk_signals`, 0140) and identity person keys (`domain/identity/identityFingerprint.ts`),
  all keyed on `IDENTITY_FINGERPRINT_SECRET`.
- **The stored payout fingerprint is Stripe's opaque bank-account fingerprint**, not the
  BSB and account number. A BSB and account number typed into a report **cannot** be
  turned into that fingerprint, so it cannot be matched against it. Member matching
  must use identifiers NoDitto can derive itself (Requirement 6).
- A staff payout hold already exists (`seller_payout_hold_reason = 'STAFF'`, honoured by
  `decideRelease`), as do the exposure override, two-person approvals for fraud
  findings (`requiresSecondApproval(..., { fraud: true })`), and the fraud ban
  (`enforceProfileFraudBan`).
- On-platform reports (`reports`, `/admin?tab=reports`) are a different thing: they
  target a NoDitto listing or user. This feature is for deals that happened elsewhere.

### Glossary

- **Scam report**: a member's account of an off-platform deal that went wrong.
- **Reporter**: the ID-verified member who files it.
- **Identifier**: a payment detail or handle the scammer used (PayID, BSB and account,
  PayPal email, crypto wallet, phone, social handle).
- **Fingerprint**: the HMAC of a normalised identifier. The only form stored.
- **Cluster**: all non-dismissed reports that share at least one fingerprint.
- **Independent reporters**: reporters who are not related to each other under
  `areRelated` (no shared card, payout account or verified person).
- **Match**: a NoDitto member whose own derived identifiers share a fingerprint with a
  report.

---

## Requirement 1: Who can report

**User story:** As a member who was scammed outside NoDitto, I want to report it, so
the same person cannot do it to someone else here.

1. WHEN a member opens the report form THEN the system SHALL require
   `identity_check_status = 'VERIFIED'`, and SHALL route an unverified member to the ID
   check with a one-line reason.
2. The system SHALL refuse a report from a fraud-banned or closed account.
3. The system SHALL limit each reporter to 3 reports in any 30 days and SHALL say so
   when the limit is reached.
4. The report form SHALL always link to ReportCyber, Scamwatch and "contact your bank",
   and SHALL say plainly that NoDitto cannot recover money lost outside NoDitto.

## Requirement 2: What a report contains

1. A report SHALL contain:
   - what happened, free text, 50 to 4,000 characters (required)
   - roughly when: month and year (required)
   - amount lost and currency (optional)
   - how they paid: bank transfer, PayID, PayPal Friends and Family, PayPal Goods and
     Services, crypto, gift card, cash, other (required)
   - at least one identifier (required), up to 10
   - evidence photos: at least 1 (required), up to 10, in a private bucket
   - a declaration that the report is true to the best of their knowledge, and that a
     knowingly false report breaches the Terms (required)
2. Identifier kinds SHALL be: PayID email, PayID phone, BSB and account number, PayPal
   email, crypto wallet address, phone number, and a social handle on any platform in
   `domain/social/socialLinks.ts`. A name the scammer used MAY be entered as free text;
   it SHALL NOT be fingerprinted or matched.
3. The system SHALL normalise each identifier before fingerprinting (Design §3) so that
   formatting differences do not prevent a match.

## Requirement 3: How identifiers are stored

1. The system SHALL store each identifier only as an HMAC fingerprint, scoped by kind,
   using the same secret as the existing risk signals.
2. The system SHALL store, beside each fingerprint, a **masked hint** for staff that
   identifies the kind without revealing the value (for example `PayID ••••@gmail.com`,
   `BSB 062-••• acct ••••1234`, `@car•••au`).
3. The raw identifier SHALL NOT be stored in any column. It remains only inside the
   reporter's own narrative and evidence, which are staff-only.

## Requirement 4: Corroboration

1. The system SHALL group reports into clusters by shared fingerprint.
2. The system SHALL compute each cluster's strength as the number of **independent**
   reporters among its non-dismissed reports.
3. Strength 1 SHALL be labelled "single report" and SHALL NOT trigger any action beyond
   staff visibility.
4. Strength 2 or more SHALL be labelled "corroborated" and SHALL raise the cluster to
   the top of the staff queue.
5. A handle-only fingerprint SHALL count at half weight towards strength, because
   handles are the identifier most often impersonated.

## Requirement 5: Staff review

1. The system SHALL provide an admin-only tab, `/admin?tab=scams`, listing clusters by
   strength, then newest report.
2. Each report SHALL show its narrative, evidence (signed URLs), masked identifiers,
   the reporter's NoDitto standing (deals, rating, account age), and every other report
   sharing a fingerprint.
3. Staff SHALL be able to mark a report reviewed, dismissed (with a reason), or
   corroborated, and keep private notes.
4. The reporter SHALL see only a status: received, then reviewed. They SHALL NOT be told
   the outcome for any person, or whether anyone matched.

## Requirement 6: Matching NoDitto members

1. The system SHALL derive fingerprints for each member from identifiers NoDitto itself
   holds:
   - `contact_email` (as PayID email and PayPal email kinds)
   - each handle in `social_links`
   - the payout bank account's BSB and last 4 digits, read from Stripe, as a separate
     **partial bank** kind, matched against the BSB and last 4 of reported bank details
2. The system SHALL NOT attempt to match phone numbers or full bank account numbers
   against members, because NoDitto does not hold them.
3. The system SHALL check for matches when a report is filed, and when a member signs
   up, changes `social_links`, completes payout setup, or applies to be a Trusted
   Seller.
4. A match SHALL record which kinds matched and SHALL be labelled by strength: payment
   identifier (strong), partial bank (medium), handle only (weak).
5. A match SHALL be visible to staff only, and SHALL appear on that member's Trusted
   Seller application if they have one.

## Requirement 7: What staff can do about a match

1. Staff SHALL be able to dismiss a match (wrong person, impersonation) with a reason.
2. Staff SHALL be able to place a staff hold on the member's unreleased payouts, set
   their open-sales limit to 0, and pause or decline a Trusted Seller application,
   using the existing controls.
3. Staff SHALL NOT be able to fraud-ban a member on off-platform reports unless:
   - the cluster is corroborated (strength 2 or more),
   - the match is on a payment identifier or partial bank, not a handle only,
   - the member has been notified and their response window (Requirement 8) has passed
     or they have responded, and
   - a second staff member approves, as for any fraud finding.
4. Nothing in this feature SHALL act automatically. Every action is a staff decision.

## Requirement 8: The person flagged can respond

1. WHEN staff choose to notify a matched member THEN the system SHALL tell them, in
   general terms, that it has received a report involving details linked to their
   account, without naming the reporter, the identifier, or the narrative.
2. The member SHALL have 14 days to respond in free text with optional photos.
3. A response SHALL be shown to staff beside the reports.
4. A dismissed match SHALL be removed from the member's record, and the member SHALL be
   told it was cleared if they had been notified.

## Requirement 9: Retention

Product decision: **reports do not expire.** Scammers come back after long gaps, and a
fingerprint that has aged out protects nobody. The cost is recorded deliberately: the
Privacy Act expects personal information to be destroyed or de-identified once it is no
longer needed (APP 11.2), so indefinite retention has to be justified by the purpose
(preventing repeat fraud) and confirmed in the legal review before launch.

1. A report that is not dismissed or withdrawn SHALL be kept indefinitely, with its
   fingerprints, matches and evidence.
2. A dismissed report SHALL be deleted 90 days after dismissal, with its fingerprints,
   matches and evidence objects. A report staff found to be wrong serves no fraud
   purpose, and keeping it only keeps an allegation about someone.
3. A withdrawn report SHALL be deleted the same way, 90 days after withdrawal.
4. A dismissed match SHALL be deleted at once; it never stays on the member's record.
5. When a reporter closes their account, their reports SHALL remain (the fingerprints
   still protect others) but their identity SHALL be detached.
6. Staff SHALL be able to delete any report manually, for example after a successful
   correction request from the person it concerns.

## Requirement 10: Never public, and gated on legal advice

1. No part of this feature SHALL be shown on any public page, profile, listing,
   directory or chat. There SHALL be no public scammer list, badge or buyer warning.
2. ~~The member-facing report form SHALL be off behind a server-side flag until legal
   advice is received.~~ Superseded: the product owner removed the flag; the form is
   always on. Legal review of privacy and defamation is still recommended.
3. The privacy policy and Terms SHALL describe the feature. (Done; not counsel-reviewed.)

## Out of scope

- Any public scammer list or community-visible warnings.
- Scraping or enriching identifiers from other platforms.
- Automatic actions of any kind.
- Recovering money for reporters.
- The references graph and vouching record. This feature feeds them later as their
  strongest negative signal, but does not build them.
