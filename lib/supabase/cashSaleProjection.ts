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
  'refund_nonce', 'refund_error', 'refund_attempts', 'created_at', 'updated_at',
].join(',');
