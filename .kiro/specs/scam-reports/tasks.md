# Tasks: Scam reports (off-platform)

**Status:** built and always on. No feature flag.

- [x] 1. Domain rules
  - `domain/risk/scamReports.ts`: normalisation, `identifierHash`, `maskIdentifier`,
    `clusterStrength`, `matchStrength`, `canFraudBan`, `validateScamReport`. The
    vocabulary (kinds, payment methods, limits) lives in `scamReportVocabulary.ts` so
    the browser form can import it without `node:crypto`.
  - Unit and property tests in `tests/unit/scamReports.test.ts`.
  - _Requirements 2, 3, 4, 7.3_

- [x] 2. Migration 0154
  - Tables `scam_reports`, `scam_report_identifiers`, `member_match_keys`,
    `scam_report_matches`; RLS on, no member grants. No `my_scam_reports()` RPC: the
    page reads the reporter's own rows with the service role, keyed by their id.
  - Private bucket `scam-report-evidence`. `profiles.match_keys_refreshed_at`.
  - Tables in `TABLES_REQUIRING_RLS`; `database.types.ts` hand-maintained.
  - _Requirements 3, 5.4, 9, 10_

- [x] 3. Member match keys
  - `lib/risk/scamMatching.ts`: `refreshMemberMatchKeys`, `findMatchesForReport`,
    `findMatchesForMember`, `backfillMemberMatchKeys`.
  - Hooked (via `after()`) into `updateProfile`, `updateSocialLinks`,
    `refreshPayoutStatus` and `requestTrustedSellerReview`. Sign-up is covered by the
    hourly backfill of `match_keys_refreshed_at is null`, not a provisioning hook.
  - Payout BSB plus last 4 is wired but inert: the Stripe binding does not populate
    `ManagedMerchant.payoutBankHint` yet.
  - _Requirement 6_

- [x] 4. Submitting a report
  - `createScamEvidenceUpload` + `uploadScamReportEvidence`.
  - `submitScamReport`: ID gate, ban and closure check, rate limit 3 per 30 days,
    validation, fingerprinting, insert, then matching. `withdrawScamReport`.
  - `/report-scam` with the reporter's status list.
  - _Requirements 1, 2, 5.4_

- [x] 5. Staff console
  - `/admin?tab=scams`: cluster cards, report detail with signed evidence, reporter
    standing, matches and responses; review, corroborate, dismiss, notes, delete.
  - Match actions: tell them, it's them, not them, hold / lift payouts.
  - Fraud ban: `proposeScamFraudBan` then `approveScamFraudBan` by a second admin
    (`canApprove`), using the match's own `ban_proposed_*` columns rather than
    `staff_resolution_proposals`.
  - Match warning on the Trusted Seller application card.
  - _Requirements 5, 7_

- [x] 6. Member response
  - Notification copy names no reporter, identifier or narrative.
  - `/report-scam/response/[id]` (not flag-gated) with the 14-day window and optional
    photos. Cleared-match notice on dismissal.
  - _Requirement 8_

- [x] 7. Retention
  - No expiry for live reports.
  - `:17` pass `scamReports`: deletes reports dismissed or withdrawn more than 90 days
    ago with their evidence and response photos (fingerprints and matches cascade),
    then backfills match keys. Dismissed matches are deleted at once by the action.
  - Closed reporters detach (`on delete set null`); staff manual delete.
  - _Requirement 9_

- [x] 8. Launch
  - The feature flag was removed at the product owner's request: the form is always on.
  - Privacy policy and Terms sections written (product policy, not counsel-reviewed).
  - Linked from `/safety` and the Help page.
  - Still open: confirm indefinite retention of live reports with a lawyer (APP 11.2).
  - _Requirement 10_
