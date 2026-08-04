-- 0034_hold_expiry_status.sql
--
-- Adds the EXPIRED terminal state for Pre_Auth_Holds.
--
-- WHY A SEPARATE STATE. VOIDED means "we deliberately released this collateral
-- at $0 cost", which is a successful escrow outcome (Req 6.7). EXPIRED means
-- "the provider released it because the Trade did not resolve inside the
-- authorisation window" — the escrow guarantee was lost, not honoured. Folding
-- the two together would make a failure indistinguishable from a success in the
-- audit trail, and would let `bothHoldsActive` keep believing collateral exists.
--
-- Online card authorisations last about 7 days. This value is reachable in
-- normal operation, not an edge case.
--
-- Split from 0035 because a new enum value cannot be USED in the same
-- transaction that adds it.

alter type cardtrade.hold_status add value if not exists 'EXPIRED';
