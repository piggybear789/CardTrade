# Design: Scam reports (off-platform)

Read with `requirements.md`. Builds on the 0140 risk-signal machinery rather than
alongside it.

## 1. Data model (migration 0154)

All tables: RLS on, **no member policies or grants** except where stated. Service role
writes; staff read through the admin console with the service role.

```
scam_reports
  id uuid pk
  reporter_id uuid null references profiles  -- null once the reporter closes their account
  status text  SUBMITTED | REVIEWED | CORROBORATED | DISMISSED | WITHDRAWN
  narrative text (50..4000)
  occurred_month date             -- first of the month
  amount_minor bigint null, currency text null
  payment_method text             -- enum-like CHECK
  scammer_name_text text null     -- free text, never fingerprinted
  evidence_paths text[] (1..10)   -- private bucket scam-report-evidence/<reporter_id>/...
  declared_at timestamptz
  staff_notes text null, reviewed_by uuid null, reviewed_at timestamptz null,
  dismiss_reason text null
  created_at timestamptz, dismissed_at timestamptz null, withdrawn_at timestamptz null
  -- no expires_at: live reports are kept indefinitely (requirements §9)

scam_report_identifiers
  report_id uuid references scam_reports on delete cascade
  kind text   PAYID_EMAIL | PAYID_PHONE | BANK_ACCOUNT | BANK_PARTIAL | PAYPAL_EMAIL
              | CRYPTO_WALLET | PHONE | HANDLE
  platform text null              -- for HANDLE: socialLinks slug
  value_hash text                 -- HMAC, kind-scoped
  hint text                       -- masked, for staff
  primary key (report_id, kind, value_hash)
  index (value_hash)

member_match_keys                 -- what NoDitto derives for each member
  profile_id uuid references profiles on delete cascade
  kind, platform, value_hash
  source text   CONTACT_EMAIL | SOCIAL_LINK | PAYOUT_ACCOUNT
  updated_at
  primary key (profile_id, kind, value_hash)

scam_report_matches
  report_id, profile_id, kinds text[], strength text  STRONG | MEDIUM | WEAK
  status text   OPEN | DISMISSED | CONFIRMED
  notified_at, response_due_at, responded_at
  member_response text null, member_response_paths text[]
  decided_by, decided_at, dismiss_reason
  primary key (report_id, profile_id)
```

**As built:** a dismissed match is deleted rather than kept, so `status` is `OPEN | CONFIRMED`
and there is no `dismiss_reason` on the match. The match also carries `ban_proposed_by`
and `ban_proposed_at`: a fraud ban is proposed on the match and approved by a second
admin through `canApprove`, rather than through `staff_resolution_proposals`.

The reporter's own view is read by the `/report-scam` page with the service role,
keyed by their own id, returning `id, status, created_at, occurred_month,
payment_method` only. There is no `my_scam_reports()` RPC. The flagged member's
response is written through a server action, never a grant.

`BANK_ACCOUNT` (full BSB plus account, from reports) clusters reports with each other.
`BANK_PARTIAL` (BSB plus last 4) is derived from **both** sides, so a report's bank
details also produce a `BANK_PARTIAL` fingerprint that can meet a member's.

## 2. Domain (pure)

`domain/risk/scamReports.ts`:

- `normaliseIdentifier(kind, raw, platform?)` (§3) → normalised string or null
- `identifierHash(kind, normalised, secret)` → HMAC `v1:scam:<kind>:<platform?>:<value>`.
  Kind-scoped and namespaced apart from `riskSignalHash`, so a scam fingerprint can
  never collide with a card or payout fingerprint.
- `maskIdentifier(kind, normalised)` → hint string
- `clusterStrength(reports, related)` → independent-reporter count, handle-only at
  half weight, dismissed excluded
- `matchStrength(kinds)` → STRONG if any payment kind, MEDIUM if `BANK_PARTIAL`,
  WEAK if only `HANDLE`
- `canFraudBan({ strength, matchStrength, notifiedAt, respondedAt, responseDueAt, now })`
  encodes Requirement 7.3; the second approval stays with `requiresSecondApproval`.
- `validateScamReport(input)` mirrors the CHECKs.

## 3. Normalisation

| Kind | Rule |
|---|---|
| PayID / PayPal email | trim, lowercase |
| PayID phone, phone | digits only, AU `04…` → `+614…`, other numbers kept with country code |
| Bank account | BSB 6 digits + account digits, separators removed; also emit `BANK_PARTIAL` = BSB + last 4 |
| Crypto wallet | trim; lowercase for `0x…` addresses, case kept otherwise |
| Handle | socialLinks `normalizeHandle`, lowercase, keyed with platform |

## 4. Server

- `lib/actions/scamReports.ts` (`'use server'`, every export via `withActionLog`):
  `createScamReportEvidenceUpload`, `submitScamReport`, `withdrawScamReport`,
  `respondToScamReportMatch`.
- `lib/actions/admin.ts`: `reviewScamReport`, `dismissScamReport`,
  `corroborateScamReport`, `notifyScamReportMatch`, `dismissScamReportMatch`,
  `confirmScamReportMatch`. Admin-gated. Holds and limits reuse the existing actions.
- `lib/risk/scamMatching.ts` (`server-only`):
  `refreshMemberMatchKeys(profileId)` (contact email, social links, Stripe external
  account BSB plus last 4) and `findMatchesForReport(reportId)` /
  `findMatchesForMember(profileId)`. Called from submit, sign-up provisioning,
  `updateSocialLinks`, payout-setup refresh and Trusted Seller application. Never
  throws into the caller; failures go to `logBackgroundFailure('risk.scam_match', …)`.
- Storage: private bucket `scam-report-evidence`, same signed-upload pattern as
  `lib/storage/trustedSellerPhotos.ts`.
- Retention: live reports are never deleted automatically. A pass in the existing
  `:17` job deletes reports dismissed or withdrawn more than 90 days ago, with their
  identifiers, matches and evidence objects. Staff can delete a report manually.
- No feature flag: the member route and actions are always on.

## 5. UI

Member, at `/report-scam` (protected), linked from `/safety` and the
Help page only:

```
Report a scam that happened outside NoDitto
[ We can't get your money back. Also report it to ReportCyber, Scamwatch and your bank. ]

What happened            [ textarea ]
When                     [ month ] [ year ]
How you paid             ( chips )
Amount (optional)        [ $ ]
Their payment details    [ kind ▾ ][ value ][ × ]   + Add another
Their handles            [ platform ▾ ][ @handle ][ × ]  + Add another
Name they used (optional)[ text ]
Evidence                 [ photo grid, 1–10 ]
[✓] This is true to the best of my knowledge
                                             [ Send report ]
```

After sending: "Thanks. We've received your report." Status list on the same page.

Staff, `/admin?tab=scams`: clusters as cards (strength badge, masked identifiers,
report count, newest date), expanding to each report and its matches. A matched
member also shows a warning line on their Trusted Seller application card.

Flagged member: an in-app notification linking to `/report-scam/response/<id>`
with the generic notice and a response form.

## 6. Why these choices

- **Fingerprints, not values.** Same reason as the card and person-key blocklists: a
  leak of this table must not be a list of people's bank details.
- **Payment details over handles.** Handles are what scammers impersonate; a bank
  account is what they cannot fake without losing the money.
- **Independent reporters only.** Two accounts run by one person reporting a rival
  would otherwise "corroborate" each other. `areRelated` already answers that.
- **No automation.** The evidence is one side's screenshots of a deal NoDitto never
  saw. Staff judgement, a response window and a second approver are the minimum.
