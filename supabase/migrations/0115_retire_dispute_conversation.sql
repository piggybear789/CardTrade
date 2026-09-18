-- 0115_retire_dispute_conversation.sql
--
-- REMOVES THE SEPARATE DISPUTE THREAD (0019) AND FOLDS IT BACK INTO THE SALE THREAD.
--
-- 0019 was written as an "eBay-style resolution center": when a Cash_Sale entered
-- DISPUTED, `attach_dispute_conversation` opened a SECOND conversation between the
-- same buyer and seller and seeded it with "Both parties can present their case here.
-- An admin will review and make a decision." Three things have happened since that
-- make it a duplicate rather than a feature:
--
--   1. The sale's own thread now carries the dispute. 0113's contextual chat writes
--      every `cash_sale_events` row into `cash_sales.conversation_id` as a SYSTEM
--      notice — "<who> raised a dispute: <reason>" — and the contract room shows a
--      "Dispute under review" dock above the composer. The conversation the two
--      parties were already having is where the dispute is visible.
--   2. Arbitration has its own workspace. 0047 added `arbitration_notes` and 0082
--      added `dispute_evidence`; admins work from `ArbitrationCaseView`. No admin was
--      ever a participant of the 0019 thread — `participant_a`/`participant_b` were
--      only ever buyer and seller — so its promise that "an admin will review" HERE
--      was never true.
--   3. Nothing read the link. `cash_sales.dispute_conversation_id` was written once
--      and only ever appeared in a projection column list; no route or panel used it.
--
-- What the member saw was the inbox in the screenshot that prompted this: two rows
-- for the same counterparty, both badged "Disputed", one of them an otherwise-empty
-- thread with an alert-triangle where the item thumbnail should be.
--
-- WHAT THIS MIGRATION DOES, IN ORDER, AND WHY THE ORDER MATTERS:
--
--   a. A sale whose ONLY thread is the dispute thread (no `conversation_id`) adopts
--      it as its contract thread. Nothing is lost and the row simply stops being
--      "the dispute chat" and becomes "the chat".
--   b. Anything a person actually typed in a dispute thread moves to the sale's
--      thread. SYSTEM rows are not moved: the sale thread already has its own
--      `DISPUTE_RAISED` notice from 0113, and the 0019 seed message is the copy this
--      migration exists to retire. Moved rows keep `created_at`, so they interleave
--      in the sale thread at the time they were sent.
--   c. The sale thread's `last_message_at` is bumped if a moved message is newer,
--      so the inbox order reflects the merge.
--   d. The now-empty dispute conversations and their remaining SYSTEM rows go.
--   e. The function, the back-reference and the scoping column go.
--
-- `messages.conversation_id` has no declared ON DELETE action (the table predates the
-- versioned migrations — see 0076), so step (d) deletes messages explicitly rather
-- than relying on a cascade.

-- a. Orphaned sales adopt their dispute thread as the contract thread.
update cardtrade.cash_sales s
set conversation_id = d.id,
    updated_at = now()
from cardtrade.conversations d
where d.cash_sale_id = s.id
  and s.conversation_id is null;

-- b. Move human messages into the sale's own thread.
update cardtrade.messages m
set conversation_id = s.conversation_id
from cardtrade.conversations d
join cardtrade.cash_sales s on s.id = d.cash_sale_id
where m.conversation_id = d.id
  and d.cash_sale_id is not null
  and s.conversation_id is not null
  and s.conversation_id <> d.id
  and m.kind = 'USER';

-- c. Keep the merged thread's inbox position honest.
update cardtrade.conversations c
set last_message_at = latest.at
from (
  select m.conversation_id, max(m.created_at) as at
  from cardtrade.messages m
  group by m.conversation_id
) latest
where latest.conversation_id = c.id
  and latest.at > c.last_message_at
  and exists (
    select 1
    from cardtrade.cash_sales s
    join cardtrade.conversations d on d.cash_sale_id = s.id
    where s.conversation_id = c.id
      and d.id <> c.id
  );

-- d. Remove the dispute threads that are not (after step a) a sale's own thread.
delete from cardtrade.messages m
using cardtrade.conversations d
join cardtrade.cash_sales s on s.id = d.cash_sale_id
where m.conversation_id = d.id
  and s.conversation_id <> d.id;

delete from cardtrade.conversations d
using cardtrade.cash_sales s
where s.id = d.cash_sale_id
  and s.conversation_id <> d.id;

-- Dispute threads whose sale row is gone (FK is ON DELETE CASCADE, so this should be
-- empty — stated for completeness rather than expected to match anything).
delete from cardtrade.messages m
using cardtrade.conversations d
where m.conversation_id = d.id
  and d.cash_sale_id is not null
  and not exists (select 1 from cardtrade.cash_sales s where s.id = d.cash_sale_id);

delete from cardtrade.conversations d
where d.cash_sale_id is not null
  and not exists (select 1 from cardtrade.cash_sales s where s.id = d.cash_sale_id);

-- e. Retire the schema. The 0072 grant on the function goes with the function.
drop function if exists cardtrade.attach_dispute_conversation(uuid, uuid);

alter table cardtrade.cash_sales
  drop column if exists dispute_conversation_id;

drop index if exists cardtrade.conversations_cash_sale_dispute_unique;

alter table cardtrade.conversations
  drop column if exists cash_sale_id;

comment on column cardtrade.cash_sales.conversation_id is
  'The one thread for this contract. Listing enquiry, negotiation, contract events and any dispute all live here; there is no separate arbitration thread.';
