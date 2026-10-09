-- 0128_email_preferences.sql
--
-- Per-kind email opt-outs.
--
-- Members had no say over which emails NoDitto sent. Three kinds are optional and get
-- a switch each in Account settings; they default ON so nothing changes for anyone
-- until they choose:
--
--   email_deal_requests     a new purchase request or trade offer
--   email_shipping_updates  an item marked shipped
--   email_payouts           a payout settled
--
-- Deadline warnings and dispute notices are deliberately NOT optional and have no
-- column: missing one can cost a member their protection or their money, so they are
-- sent regardless. The in-app notification centre is unaffected by these flags.
--
-- SELECT and UPDATE are granted per column to `authenticated`, the same pattern as
-- every member-editable profile column (0066, 0070, 0072). `profiles_owner_update`
-- scopes the update to the member's own row.

alter table cardtrade.profiles
  add column if not exists email_deal_requests boolean not null default true,
  add column if not exists email_shipping_updates boolean not null default true,
  add column if not exists email_payouts boolean not null default true;

comment on column cardtrade.profiles.email_deal_requests is
  'Email when a purchase request or trade offer arrives (0128). Default on.';
comment on column cardtrade.profiles.email_shipping_updates is
  'Email when the other party marks an item shipped (0128). Default on.';
comment on column cardtrade.profiles.email_payouts is
  'Email when a payout settles (0128). Default on.';

grant select (email_deal_requests, email_shipping_updates, email_payouts)
  on cardtrade.profiles to authenticated;
grant update (email_deal_requests, email_shipping_updates, email_payouts)
  on cardtrade.profiles to authenticated;
