-- CardTrade — 0007_payment_method_label.sql
-- Provider-controlled, display-safe payment source description.

alter table cardtrade.profiles
  add column if not exists payment_method_label text;

comment on column cardtrade.profiles.payment_method_label is
  'Provider-controlled, display-safe payment source label (for example, bank account ending in 1234); never a reusable payment credential.';

-- RLS limits rows, while this column privilege prevents owners from changing the
-- provider-controlled label on their own Profile.
revoke update (payment_method_label) on cardtrade.profiles from authenticated;
