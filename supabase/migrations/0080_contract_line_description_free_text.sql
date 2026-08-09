-- 0080_contract_line_description_free_text.sql
--
-- Widen `cash_sale_items.description` from 200 to 1000 characters.
--
-- WHY. 0064 sized this field for one card named on one line — "Charizard ex
-- 199/165 — SV 151" — because the buyer composed a binder request as a grid of
-- rows. That grid is gone from the request surface: a buyer now WRITES what they
-- want from a binder or bulk lot in prose and names a price for it, which is how
-- people actually ask for bulk ("the three Charizards on page 2, both Blastoise,
-- and any NM Pikachu"). 200 characters truncates that sentence, and a truncated
-- statement of what a contract covers is the one thing this column must never be:
-- arbitration reads it and nothing else.
--
-- Widening only. Every existing row already satisfies the new bound, so this is
-- reversible by re-narrowing once no row exceeds 200 again.
--
-- The line model itself is unchanged. A contract may still carry up to 50 lines
-- with per-line condition and quantity — the renegotiation surface still uses
-- them — so nothing downstream (`replace_cash_sale_items`, the price derivation,
-- the arbitration read) needs to know this happened.

alter table cardtrade.cash_sale_items
  drop constraint cash_sale_items_description_length;

alter table cardtrade.cash_sale_items
  add constraint cash_sale_items_description_length
    check (char_length(description) between 1 and 1000);

comment on column cardtrade.cash_sale_items.description is
  'What this line of the contract covers, as the parties agreed it. Free prose for a binder or bulk request; a single card name when the line is itemised. Read by arbitration verbatim.';
