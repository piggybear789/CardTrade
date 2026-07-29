-- 0022_location_geo.sql
--
-- Structured geo for listing base locations (suburb-level public display) and
-- in-person meetup points on deals / cash sales. Text labels stay for display
-- and backwards compatibility; lat/lng power Mapbox maps.

-- ---------------------------------------------------------------------------
-- Items — where the listing is based (catalog-public, suburb precision)
-- ---------------------------------------------------------------------------
alter table cardtrade.items
  add column if not exists location_label text,
  add column if not exists location_place_id text,
  add column if not exists location_lat double precision,
  add column if not exists location_lng double precision,
  add column if not exists location_precision text;

alter table cardtrade.items
  drop constraint if exists items_location_precision_check;

alter table cardtrade.items
  add constraint items_location_precision_check
  check (
    location_precision is null
    or location_precision in ('suburb', 'exact')
  );

alter table cardtrade.items
  drop constraint if exists items_location_coords_check;

alter table cardtrade.items
  add constraint items_location_coords_check
  check (
    (location_lat is null and location_lng is null)
    or (
      location_lat is not null
      and location_lng is not null
      and location_lat between -90 and 90
      and location_lng between -180 and 180
    )
  );

comment on column cardtrade.items.location_label is
  'Public display label, e.g. Fitzroy, VIC (suburb-level for privacy).';
comment on column cardtrade.items.location_place_id is
  'Mapbox feature id used when the place was selected.';
comment on column cardtrade.items.location_lat is
  'WGS84 latitude of the public listing pin (usually locality centroid).';
comment on column cardtrade.items.location_lng is
  'WGS84 longitude of the public listing pin.';
comment on column cardtrade.items.location_precision is
  'suburb = catalog-safe locality; exact = street/POI (not used for listings in v1).';

-- ---------------------------------------------------------------------------
-- Deals — meetup geo beside meeting_location text
-- ---------------------------------------------------------------------------
alter table cardtrade.deals
  add column if not exists meeting_lat double precision,
  add column if not exists meeting_lng double precision,
  add column if not exists meeting_place_id text;

alter table cardtrade.deals
  drop constraint if exists deals_meeting_coords_check;

alter table cardtrade.deals
  add constraint deals_meeting_coords_check
  check (
    (meeting_lat is null and meeting_lng is null)
    or (
      meeting_lat is not null
      and meeting_lng is not null
      and meeting_lat between -90 and 90
      and meeting_lng between -180 and 180
    )
  );

comment on column cardtrade.deals.meeting_lat is
  'WGS84 latitude of the agreed in-person meeting point.';
comment on column cardtrade.deals.meeting_lng is
  'WGS84 longitude of the agreed in-person meeting point.';
comment on column cardtrade.deals.meeting_place_id is
  'Mapbox feature id for the meeting point.';

-- ---------------------------------------------------------------------------
-- Cash sales — meetup geo beside meeting_location text
-- ---------------------------------------------------------------------------
alter table cardtrade.cash_sales
  add column if not exists meeting_lat double precision,
  add column if not exists meeting_lng double precision,
  add column if not exists meeting_place_id text;

alter table cardtrade.cash_sales
  drop constraint if exists cash_sales_meeting_coords_check;

alter table cardtrade.cash_sales
  add constraint cash_sales_meeting_coords_check
  check (
    (meeting_lat is null and meeting_lng is null)
    or (
      meeting_lat is not null
      and meeting_lng is not null
      and meeting_lat between -90 and 90
      and meeting_lng between -180 and 180
    )
  );

comment on column cardtrade.cash_sales.meeting_lat is
  'WGS84 latitude of the agreed in-person meeting point.';
comment on column cardtrade.cash_sales.meeting_lng is
  'WGS84 longitude of the agreed in-person meeting point.';
comment on column cardtrade.cash_sales.meeting_place_id is
  'Mapbox feature id for the meeting point.';
