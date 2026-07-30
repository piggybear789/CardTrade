-- CardTrade — 0024_trade_shipment_tracking.sql
--
-- Per-trader carrier tracking on live trades (delivery branch). Face-to-face
-- trades leave these null; delivery trades fill them when recording shipment.

alter table cardtrade.trades
  add column if not exists initiator_tracking_carrier text,
  add column if not exists initiator_tracking_number text,
  add column if not exists initiator_tracking_url text,
  add column if not exists counterpart_tracking_carrier text,
  add column if not exists counterpart_tracking_number text,
  add column if not exists counterpart_tracking_url text;

comment on column cardtrade.trades.initiator_tracking_carrier is
  'Carrier name for the initiator''s outbound shipment (delivery trades).';
comment on column cardtrade.trades.initiator_tracking_number is
  'Tracking number for the initiator''s outbound shipment.';
comment on column cardtrade.trades.initiator_tracking_url is
  'Optional carrier tracking URL for the initiator''s shipment.';
comment on column cardtrade.trades.counterpart_tracking_carrier is
  'Carrier name for the counterpart''s outbound shipment (delivery trades).';
comment on column cardtrade.trades.counterpart_tracking_number is
  'Tracking number for the counterpart''s outbound shipment.';
comment on column cardtrade.trades.counterpart_tracking_url is
  'Optional carrier tracking URL for the counterpart''s shipment.';
