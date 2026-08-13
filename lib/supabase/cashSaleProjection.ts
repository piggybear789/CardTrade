// lib/supabase/cashSaleProjection.ts
// Browser-safe Cash_Sale projection. Residential delivery details live in the
// separately RLS-gated cash_sale_delivery_details table and must never be added here.

export const CASH_SALE_PUBLIC_SELECT = [
  'id', 'item_id', 'buyer_id', 'seller_id', 'amount_cents', 'agreed_price_cents',
  'platform_fee_cents', 'status', 'version', 'transfer_id', 'payment_nonce',
  'payment_requested_at', 'payment_settled_at', 'item_title', 'item_description',
  'item_condition', 'item_image_paths', 'fulfillment_method', 'shipping_cost_cents',
  'shipping_notes', 'delivery_address_configured', 'meeting_location', 'meeting_lat',
  'meeting_lng', 'meeting_place_id', 'meeting_at', 'terms_version', 'terms_updated_at',
  'buyer_terms_accepted_version', 'seller_terms_accepted_version',
  'buyer_terms_accepted_at', 'seller_terms_accepted_at', 'tracking_carrier',
  'tracking_number', 'tracking_url', 'tracking_status', 'shipped_at', 'received_at',
  'inspection_accepted_at', 'carrier_delivered_at', 'inspection_deadline_at',
  'auto_completed', 'buyer_handover_confirmed_at', 'seller_handover_confirmed_at',
  'completed_at', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'disputed_at',
  'disputed_by', 'dispute_reason', 'dispute_conversation_id', 'conversation_id',
  'seller_identity_version', 'seller_legal_entity_name', 'seller_trading_name',
  'seller_registration_number', 'seller_organisation_type',
  'seller_identity_verified_at', 'buyer_seller_identity_confirmed_at',
  'seller_payout_status', 'seller_payout_ref', 'seller_payout_nonce',
  'seller_payout_due_at', 'seller_payout_at', 'seller_payout_attempts',
  'seller_payout_error', 'dispute_resolution', 'dispute_resolved_at',
  'dispute_resolved_by', 'refund_cents', 'refund_status', 'refund_ref',
  'refund_nonce', 'refund_error', 'refund_attempts',
  // 0088. The RETURN leg, kept fully separate from the outbound tracking columns
  // above so a return event cannot overwrite the original delivery record that the
  // first inspection — and any arbitration — reads. Both legs are needed here: the
  // room shows the buyer where to post and the seller what is coming back, and the
  // deadline drives the countdown.
  'return_tracking_carrier', 'return_tracking_number', 'return_tracking_status',
  'return_tracking_url', 'return_carrier_delivered_at', 'return_shipped_at',
  'return_deadline_at', 'return_warned_at', 'return_disputed_at',
  'return_dispute_reason',
  // 0064. Drives the contract room's whole reading of itself: a shopfront
  // contract shows its line items instead of the listing snapshot, and prices
  // from those lines rather than from a directly proposed figure.
  'from_shopfront',
  // 0068. Without this the contract room reads every `*_cents` column above with no
  // idea what they are denominated in, so a GBP contract would render as dollars —
  // a wrong number rather than a missing one, which is the worse failure. This list
  // is explicit precisely so a new money-relevant column has to be added here
  // deliberately.
  'currency',
  'created_at', 'updated_at',
].join(',');
