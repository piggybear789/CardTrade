-- 0068_multi_region_currency.sql
--
-- Records the currency each money-bearing row is denominated in, and gives SQL a
-- region table to derive it from.
--
-- WHY THIS IS NEEDED EVEN THOUGH DEALS ARE INTRA-REGION ONLY.
-- Intra-region means the two PARTIES share a currency, so nothing ever converts.
-- It does not mean the platform is single-currency: with more than one region live
-- the platform holds AUD and GBP and EUR simultaneously, and a bare integer in a
-- `*_cents` column no longer says which. Every figure on the payouts console, every
-- notification quoting an amount, and every provider call that must name a currency
-- needs the answer, and re-deriving it by joining back to the seller's profile
-- would make a contract's denomination MOVE if that profile's region were ever
-- corrected. A contract's currency is a fact about the contract, frozen when it is
-- created — the same reasoning that freezes the seller identity snapshot.
--
-- WHY A REGION TABLE AND NOT A CASE EXPRESSION.
-- The mapping region → currency already exists in `domain/region/regions.ts`, and
-- it is the ONE place a region becomes a currency. Restating it as SQL in a trigger
-- body would be a second copy that can silently drift. Instead the mapping becomes
-- a table, the trigger reads it, and `tests/unit/regionCurrencyAgreement.test.ts`
-- parses this file and asserts every row matches the TypeScript registry — the same
-- pinning `tests/property/identityGate.test.ts` applies to the Identity_Gate and
-- `replace_cash_sale_items` applies to the line-item total.

-- ---------------------------------------------------------------------------
-- 1. The region table
-- ---------------------------------------------------------------------------
--
-- Reference data, not member data: readable by everyone, writable by no one but a
-- migration. Every country Stripe supports separate charges and transfers in.
create table if not exists cardtrade.regions (
  code text primary key check (code ~ '^[A-Z]{2}$'),
  label text not null check (char_length(btrim(label)) between 1 and 100),
  -- ISO 4217, lowercase to match Stripe's own representation.
  currency text not null check (currency ~ '^[a-z]{3}$'),
  -- 0 or 2. Three-decimal currencies are deliberately unrepresentable here: the
  -- integer-minor-unit money model would understate them tenfold, so the TypeScript
  -- side throws rather than guessing and this CHECK refuses to record one.
  minor_unit_digits smallint not null check (minor_unit_digits in (0, 2)),
  -- Product intent only. A region is genuinely live only when a Stripe platform
  -- binding is also configured for it, which is a runtime fact no column can hold.
  trading_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table cardtrade.regions is
  'Jurisdictions the marketplace can operate in — one row per country Stripe '
  'supports separate charges and transfers in. Mirrors domain/region/regions.ts, '
  'pinned by tests/unit/regionCurrencyAgreement.test.ts. `trading_enabled` is '
  'product intent; a region also needs a configured Stripe platform account, which '
  'is why the app re-checks via operationalRegions().';

alter table cardtrade.regions enable row level security;

drop policy if exists regions_public_read on cardtrade.regions;
create policy regions_public_read on cardtrade.regions
  for select using (true);

grant select on cardtrade.regions to anon, authenticated;

insert into cardtrade.regions (code, label, currency, minor_unit_digits, trading_enabled) values
  ('AE', 'United Arab Emirates', 'aed', 2, false),
  ('AT', 'Austria',              'eur', 2, false),
  ('AU', 'Australia',            'aud', 2, true ),
  ('BE', 'Belgium',              'eur', 2, false),
  ('BG', 'Bulgaria',             'bgn', 2, false),
  ('BR', 'Brazil',               'brl', 2, false),
  ('CA', 'Canada',               'cad', 2, false),
  ('CH', 'Switzerland',          'chf', 2, false),
  ('CY', 'Cyprus',               'eur', 2, false),
  ('CZ', 'Czechia',              'czk', 2, false),
  ('DE', 'Germany',              'eur', 2, false),
  ('DK', 'Denmark',              'dkk', 2, false),
  ('EE', 'Estonia',              'eur', 2, false),
  ('ES', 'Spain',                'eur', 2, false),
  ('FI', 'Finland',              'eur', 2, false),
  ('FR', 'France',               'eur', 2, false),
  ('GB', 'United Kingdom',       'gbp', 2, false),
  ('GR', 'Greece',               'eur', 2, false),
  ('HR', 'Croatia',              'eur', 2, false),
  ('HU', 'Hungary',              'huf', 2, false),
  ('IE', 'Ireland',              'eur', 2, false),
  ('IT', 'Italy',                'eur', 2, false),
  ('JP', 'Japan',                'jpy', 0, false),
  ('LI', 'Liechtenstein',        'chf', 2, false),
  ('LT', 'Lithuania',            'eur', 2, false),
  ('LU', 'Luxembourg',           'eur', 2, false),
  ('LV', 'Latvia',               'eur', 2, false),
  ('MT', 'Malta',                'eur', 2, false),
  ('MX', 'Mexico',               'mxn', 2, false),
  ('MY', 'Malaysia',             'myr', 2, false),
  ('NL', 'Netherlands',          'eur', 2, false),
  ('NO', 'Norway',               'nok', 2, false),
  ('NZ', 'New Zealand',          'nzd', 2, false),
  ('PL', 'Poland',               'pln', 2, false),
  ('PT', 'Portugal',             'eur', 2, false),
  ('RO', 'Romania',              'ron', 2, false),
  ('SE', 'Sweden',               'sek', 2, false),
  ('SG', 'Singapore',            'sgd', 2, false),
  ('SI', 'Slovenia',             'eur', 2, false),
  ('SK', 'Slovakia',             'eur', 2, false),
  ('US', 'United States',        'usd', 2, false)
on conflict (code) do update
  set label = excluded.label,
      currency = excluded.currency,
      minor_unit_digits = excluded.minor_unit_digits,
      trading_enabled = excluded.trading_enabled;

-- Now that the table exists, pin `profiles.region_code` to it. 0065 could only
-- shape-check the value; this makes an unknown region unstorable.
alter table cardtrade.profiles
  drop constraint if exists profiles_region_code_fkey;

alter table cardtrade.profiles
  add constraint profiles_region_code_fkey
  foreign key (region_code) references cardtrade.regions(code);

-- `items.location_country_code` is deliberately NOT constrained this way. It is the
-- country of the GOODS, resolved by Google Places, and a listing may legitimately
-- sit in a country the platform does not operate in — a seller posting from abroad.
-- A foreign key would refuse the listing instead of simply leaving it out of scope.

-- ---------------------------------------------------------------------------
-- 2. Currency on the money-bearing rows
-- ---------------------------------------------------------------------------
--
-- Defaulted to 'aud' rather than left null so every existing row and every insert
-- path that predates this migration stays valid. The trigger below overrides the
-- default with the payee's real region currency, so the default is a safety net for
-- rows created before regions existed, not the normal path.

alter table cardtrade.items
  add column if not exists currency text not null default 'aud'
    check (currency ~ '^[a-z]{3}$');

comment on column cardtrade.items.currency is
  'ISO 4217 currency `fmv_cents` is denominated in, from the OWNER''s region at '
  'creation. Not the same as location_country_code, which is where the goods are.';

alter table cardtrade.cash_sales
  add column if not exists currency text not null default 'aud'
    check (currency ~ '^[a-z]{3}$');

comment on column cardtrade.cash_sales.currency is
  'ISO 4217 currency every *_cents column on this contract is denominated in. '
  'Frozen at creation from the seller''s region: a contract''s denomination must '
  'not move if that profile is later corrected.';

alter table cardtrade.trades
  add column if not exists currency text not null default 'aud'
    check (currency ~ '^[a-z]{3}$');

comment on column cardtrade.trades.currency is
  'ISO 4217 currency the collateral, fees and any cash leg are denominated in. '
  'Both traders are in one region by the contract guard, so there is exactly one.';

-- ---------------------------------------------------------------------------
-- 3. Derive the currency on insert
-- ---------------------------------------------------------------------------
--
-- A TRIGGER rather than a column list in each RPC, because `create_cash_sale_agreement`
-- and `open_trade_negotiation` are not the only insert paths — seeds, admin
-- backfills and future RPCs all write these tables. A trigger cannot be forgotten;
-- an argument can.
--
-- It only fires when the caller left the DEFAULT in place, so an explicit currency
-- from the orchestrator always wins and this never silently rewrites a considered
-- value.

create or replace function cardtrade.set_row_currency_from_region()
returns trigger
language plpgsql
security definer
set search_path = cardtrade, public
as $$
declare
  v_region text;
  v_currency text;
  v_owner uuid;
begin
  -- Respect an explicitly supplied currency. Only the untouched default is derived.
  if new.currency is not null and new.currency <> 'aud' then
    return new;
  end if;

  -- Whose region denominates this row: the party who RECEIVES the money, because
  -- that is whose Stripe account the funds settle into.
  if tg_table_name = 'items' then
    v_owner := new.owner_id;
  elsif tg_table_name = 'cash_sales' then
    v_owner := new.seller_id;
  elsif tg_table_name = 'trades' then
    -- A trade has two payees and the contract guard has already established that
    -- both are in one region, so the initiator's answer is the trade's answer.
    v_owner := new.initiator_id;
  else
    return new;
  end if;

  select p.region_code into v_region
    from cardtrade.profiles p
   where p.id = v_owner;

  if v_region is null then
    return new;
  end if;

  select r.currency into v_currency
    from cardtrade.regions r
   where r.code = v_region;

  if v_currency is not null then
    new.currency := v_currency;
  end if;

  return new;
end;
$$;

comment on function cardtrade.set_row_currency_from_region() is
  'Derives a row''s currency from the PAYEE''s region via cardtrade.regions. Only '
  'fires when the currency is still the default, so an explicit value always wins.';

drop trigger if exists items_set_currency on cardtrade.items;
create trigger items_set_currency
  before insert on cardtrade.items
  for each row execute function cardtrade.set_row_currency_from_region();

drop trigger if exists cash_sales_set_currency on cardtrade.cash_sales;
create trigger cash_sales_set_currency
  before insert on cardtrade.cash_sales
  for each row execute function cardtrade.set_row_currency_from_region();

drop trigger if exists trades_set_currency on cardtrade.trades;
create trigger trades_set_currency
  before insert on cardtrade.trades
  for each row execute function cardtrade.set_row_currency_from_region();

-- ---------------------------------------------------------------------------
-- 4. Backfill existing rows
-- ---------------------------------------------------------------------------
--
-- Every row that exists was created while the platform was AU-only and Stripe was
-- called with a hardcoded `aud`, so this is a readback rather than an assumption —
-- the same justification 0067 recorded for `profiles.region_code`.

update cardtrade.items i
   set currency = coalesce(
         (select r.currency
            from cardtrade.profiles p
            join cardtrade.regions r on r.code = p.region_code
           where p.id = i.owner_id),
         'aud')
 where i.currency = 'aud';

update cardtrade.cash_sales s
   set currency = coalesce(
         (select r.currency
            from cardtrade.profiles p
            join cardtrade.regions r on r.code = p.region_code
           where p.id = s.seller_id),
         'aud')
 where s.currency = 'aud';

update cardtrade.trades t
   set currency = coalesce(
         (select r.currency
            from cardtrade.profiles p
            join cardtrade.regions r on r.code = p.region_code
           where p.id = t.initiator_id),
         'aud')
 where t.currency = 'aud';
