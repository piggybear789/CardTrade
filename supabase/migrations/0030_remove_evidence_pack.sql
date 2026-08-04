-- 0030_remove_evidence_pack.sql
--
-- Withdraw the "Police_Evidence_Pack" feature (formerly Req 8.4, 8.7).
--
-- WHY. It generated a PDF carrying the accused Trader's legal name, date of
-- birth and government document number, and `downloadEvidencePack` exposed it to
-- any trade PARTICIPANT. A victim could therefore obtain the accused's identity
-- documents on the strength of an in-app fraud determination made by the
-- platform, with no court order, no police involvement and no appeal. That was
-- harmless while the identity data was simulated by the mock KYC service; it
-- became a real disclosure problem the moment provider identity verification
-- started returning genuine government-document fields.
--
-- Removed rather than access-restricted, so the platform never reads verified
-- identity fields at all. Identity verification is now pass/fail only: the
-- provider's verification webhook moves `kyc_status` and nothing more. If a
-- lawful request for identity data arrives, it should be served by a human out of
-- band from the provider's own dashboard.
--
-- Neither column was ever populated in practice: the `evidence-packs` Storage
-- bucket was never created, so the generator built PDF bytes and discarded them.
--
-- The name was also never a real thing. There is no law-enforcement artifact
-- called a "Police Evidence Pack"; the Australian equivalents are a Suspicious
-- Matter Report to AUSTRAC or a police report filed by the complainant.

alter table cardtrade.trades
  drop column if exists evidence_pack_path,
  drop column if exists evidence_pack_complete;
