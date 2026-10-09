-- 0126_notification_context.sql
--
-- What a notification is ABOUT, as data rather than prose.
--
-- Every row carried a title and a generic body ("A buyer wants to purchase from your
-- listing"), so fifteen purchase requests on one card read as fifteen identical lines
-- with no item, no buyer and no price — the details the matching email already had.
-- These columns let the list name the card, show its photo, name the other member and
-- state the amount, and let repeats on one listing be collapsed into one row.
--
-- All nullable and all optional: an older row, or a notification that is not about a
-- listing (a payout, a system notice), simply leaves them empty and renders as before.
--
--   subject_title  the listing's title at the moment the notification was raised
--   image_path     its cover photo, an object path in the item-images bucket
--   actor_name     the other member's PUBLIC display name — never a legal name
--   amount_cents   the money involved, in `currency`'s minor units
--   currency       ISO 4217, lower case, matching `items.currency`

alter table cardtrade.notifications
  add column if not exists subject_title text,
  add column if not exists image_path text,
  add column if not exists actor_name text,
  add column if not exists amount_cents bigint,
  add column if not exists currency text;

alter table cardtrade.notifications
  drop constraint if exists notifications_amount_non_negative;
alter table cardtrade.notifications
  add constraint notifications_amount_non_negative check (amount_cents is null or amount_cents >= 0);
