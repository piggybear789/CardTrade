// CardTrade — Supabase database types
//
// HAND-AUTHORED to faithfully mirror the SQL migrations in
// `supabase/migrations/` (0001_schema.sql, 0002_rls.sql, 0003_realtime.sql).
//
// This environment has no linked/running Supabase instance, so the standard
// generator (`supabase gen types typescript`) cannot be run here. The shape
// below intentionally matches the output that
//   supabase gen types typescript --local > lib/supabase/database.types.ts
// (or `--project-id <ref>`) produces, so it can be regenerated later to match
// once a Supabase instance is linked — with no changes required at call sites.
//
// Type mapping used (Postgres -> TypeScript):
//   uuid          -> string
//   text          -> string
//   text[]        -> string[]
//   bigint        -> number
//   integer       -> number
//   boolean       -> boolean
//   timestamptz   -> string
//   jsonb         -> Json
//   enum          -> the corresponding string-literal union (see Enums below)
//
// Nullability follows the migration: columns without NOT NULL (and without a
// server-side default that always populates them) are `T | null` in Row.
// Insert marks columns optional when they have a default or are nullable.
// Update marks every column optional.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // CardTrade lives in its own `cardtrade` Postgres schema (isolated from the
  // shared instance's `public` schema). The Supabase clients are configured
  // with `db: { schema: 'cardtrade' }` so `.from(...)` resolves here.
  cardtrade: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          contact_email: string;
          kyc_status: Database['cardtrade']['Enums']['kyc_status'];
          kyc_reason: string | null;
          payer_id: string | null;
          payment_token: string | null;
          payment_token_type: 'credit-card' | 'bank-account' | null;
          payment_method_label: string | null;
          payment_source_id: string | null;
          merchant_ref: string | null;
          merchant_status: Database['cardtrade']['Enums']['merchant_status'];
          merchant_compliance_status: string | null;
          merchant_live_enabled: boolean;
          merchant_transactions_enabled: boolean;
          merchant_settlements_enabled: boolean;
          merchant_submitted_at: string | null;
          merchant_decision_at: string | null;
          merchant_notes: string | null;
          merchant_legal_entity_name: string | null;
          merchant_trading_name: string | null;
          merchant_registration_number: string | null;
          merchant_organisation_type: string | null;
          merchant_identity_version: string | null;
          merchant_identity_disclosure_consented_at: string | null;
          merchant_identity_verified_at: string | null;
          rating: number | null;
          rating_count: number;
          is_admin: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          contact_email: string;
          kyc_status?: Database['cardtrade']['Enums']['kyc_status'];
          kyc_reason?: string | null;
          payer_id?: string | null;
          payment_token?: string | null;
          payment_token_type?: 'credit-card' | 'bank-account' | null;
          payment_method_label?: string | null;
          payment_source_id?: string | null;
          merchant_ref?: string | null;
          merchant_status?: Database['cardtrade']['Enums']['merchant_status'];
          merchant_compliance_status?: string | null;
          merchant_live_enabled?: boolean;
          merchant_transactions_enabled?: boolean;
          merchant_settlements_enabled?: boolean;
          merchant_submitted_at?: string | null;
          merchant_decision_at?: string | null;
          merchant_notes?: string | null;
          merchant_legal_entity_name?: string | null;
          merchant_trading_name?: string | null;
          merchant_registration_number?: string | null;
          merchant_organisation_type?: string | null;
          merchant_identity_version?: string | null;
          merchant_identity_disclosure_consented_at?: string | null;
          merchant_identity_verified_at?: string | null;
          rating?: number | null;
          rating_count?: number;
          is_admin?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          contact_email?: string;
          kyc_status?: Database['cardtrade']['Enums']['kyc_status'];
          kyc_reason?: string | null;
          payer_id?: string | null;
          payment_token?: string | null;
          payment_token_type?: 'credit-card' | 'bank-account' | null;
          payment_method_label?: string | null;
          payment_source_id?: string | null;
          merchant_ref?: string | null;
          merchant_status?: Database['cardtrade']['Enums']['merchant_status'];
          merchant_compliance_status?: string | null;
          merchant_live_enabled?: boolean;
          merchant_transactions_enabled?: boolean;
          merchant_settlements_enabled?: boolean;
          merchant_submitted_at?: string | null;
          merchant_decision_at?: string | null;
          merchant_notes?: string | null;
          merchant_legal_entity_name?: string | null;
          merchant_trading_name?: string | null;
          merchant_registration_number?: string | null;
          merchant_organisation_type?: string | null;
          merchant_identity_version?: string | null;
          merchant_identity_disclosure_consented_at?: string | null;
          merchant_identity_verified_at?: string | null;
          rating?: number | null;
          rating_count?: number;
          is_admin?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'profiles_id_fkey';
            columns: ['id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      payer_refs: {
        Row: {
          id: string;
          profile_id: string;
          /** `''` denotes the platform (parent) merchant. */
          merchant_ref: string;
          payer_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          merchant_ref?: string;
          payer_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          profile_id?: string;
          merchant_ref?: string;
          payer_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payer_refs_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      items: {
        Row: {
          id: string;
          owner_id: string;
          title: string;
          description: string;
          category: string;
          condition: string;
          fmv_cents: number;
          status: Database['cardtrade']['Enums']['item_status'];
          image_paths: string[];
          hidden: boolean;
          seller_rating: number | null;
          seller_verified: boolean;
          location_label: string | null;
          location_place_id: string | null;
          location_lat: number | null;
          location_lng: number | null;
          location_precision: 'suburb' | 'exact' | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          title: string;
          description: string;
          category: string;
          condition: string;
          fmv_cents: number;
          status?: Database['cardtrade']['Enums']['item_status'];
          image_paths: string[];
          hidden?: boolean;
          seller_rating?: number | null;
          seller_verified?: boolean;
          location_label?: string | null;
          location_place_id?: string | null;
          location_lat?: number | null;
          location_lng?: number | null;
          location_precision?: 'suburb' | 'exact' | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          title?: string;
          description?: string;
          category?: string;
          condition?: string;
          fmv_cents?: number;
          status?: Database['cardtrade']['Enums']['item_status'];
          image_paths?: string[];
          hidden?: boolean;
          seller_rating?: number | null;
          seller_verified?: boolean;
          location_label?: string | null;
          location_place_id?: string | null;
          location_lat?: number | null;
          location_lng?: number | null;
          location_precision?: 'suburb' | 'exact' | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'items_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      trades: {
        Row: {
          id: string;
          initiator_id: string;
          counterpart_id: string;
          initiator_item_id: string;
          counterpart_item_id: string;
          state: Database['cardtrade']['Enums']['trade_state'];
          version: number;
          initiator_shipped_at: string | null;
          counterpart_shipped_at: string | null;
          initiator_tracking_carrier: string | null;
          initiator_tracking_number: string | null;
          initiator_tracking_url: string | null;
          counterpart_tracking_carrier: string | null;
          counterpart_tracking_number: string | null;
          counterpart_tracking_url: string | null;
          initiator_received_at: string | null;
          counterpart_received_at: string | null;
          initiator_accepted_at: string | null;
          counterpart_accepted_at: string | null;
          dispute_raised_by: string | null;
          disputed_against: string | null;
          disputed_at: string | null;
          fraud_victim_id: string | null;
          evidence_pack_path: string | null;
          evidence_pack_complete: boolean | null;
          cash_amount_cents: number;
          cash_direction: Database['cardtrade']['Enums']['trade_cash_direction'];
          handover_method: Database['cardtrade']['Enums']['handover_method'] | null;
          meeting_location: string | null;
          meeting_lat: number | null;
          meeting_lng: number | null;
          meeting_place_id: string | null;
          meeting_at: string | null;
          delivery_details: string | null;
          delivery_cost_cents: number | null;
          friction_tax_return_cents: number | null;
          friction_tax_platform_cents: number | null;
          partial_capture_failed: boolean;
          return_overdue: boolean;
          full_capture_failed: boolean;
          manual_reconciliation: boolean;
          created_at: string;
          updated_at: string;
          conversation_id: string | null;
        };
        Insert: {
          id?: string;
          initiator_id: string;
          counterpart_id: string;
          initiator_item_id: string;
          counterpart_item_id: string;
          state?: Database['cardtrade']['Enums']['trade_state'];
          version?: number;
          initiator_shipped_at?: string | null;
          counterpart_shipped_at?: string | null;
          initiator_tracking_carrier?: string | null;
          initiator_tracking_number?: string | null;
          initiator_tracking_url?: string | null;
          counterpart_tracking_carrier?: string | null;
          counterpart_tracking_number?: string | null;
          counterpart_tracking_url?: string | null;
          initiator_received_at?: string | null;
          counterpart_received_at?: string | null;
          initiator_accepted_at?: string | null;
          counterpart_accepted_at?: string | null;
          dispute_raised_by?: string | null;
          disputed_against?: string | null;
          disputed_at?: string | null;
          fraud_victim_id?: string | null;
          evidence_pack_path?: string | null;
          evidence_pack_complete?: boolean | null;
          cash_amount_cents?: number;
          cash_direction?: Database['cardtrade']['Enums']['trade_cash_direction'];
          handover_method?: Database['cardtrade']['Enums']['handover_method'] | null;
          meeting_location?: string | null;
          meeting_lat?: number | null;
          meeting_lng?: number | null;
          meeting_place_id?: string | null;
          meeting_at?: string | null;
          delivery_details?: string | null;
          delivery_cost_cents?: number | null;
          friction_tax_return_cents?: number | null;
          friction_tax_platform_cents?: number | null;
          partial_capture_failed?: boolean;
          return_overdue?: boolean;
          full_capture_failed?: boolean;
          manual_reconciliation?: boolean;
          created_at?: string;
          updated_at?: string;
          conversation_id?: string | null;
        };
        Update: {
          id?: string;
          initiator_id?: string;
          counterpart_id?: string;
          initiator_item_id?: string;
          counterpart_item_id?: string;
          cash_amount_cents?: number;
          cash_direction?: Database['cardtrade']['Enums']['trade_cash_direction'];
          handover_method?: Database['cardtrade']['Enums']['handover_method'] | null;
          meeting_location?: string | null;
          meeting_lat?: number | null;
          meeting_lng?: number | null;
          meeting_place_id?: string | null;
          meeting_at?: string | null;
          delivery_details?: string | null;
          delivery_cost_cents?: number | null;
          state?: Database['cardtrade']['Enums']['trade_state'];
          version?: number;
          initiator_shipped_at?: string | null;
          counterpart_shipped_at?: string | null;
          initiator_tracking_carrier?: string | null;
          initiator_tracking_number?: string | null;
          initiator_tracking_url?: string | null;
          counterpart_tracking_carrier?: string | null;
          counterpart_tracking_number?: string | null;
          counterpart_tracking_url?: string | null;
          initiator_received_at?: string | null;
          counterpart_received_at?: string | null;
          initiator_accepted_at?: string | null;
          counterpart_accepted_at?: string | null;
          dispute_raised_by?: string | null;
          disputed_against?: string | null;
          disputed_at?: string | null;
          conversation_id?: string | null;
          fraud_victim_id?: string | null;
          evidence_pack_path?: string | null;
          evidence_pack_complete?: boolean | null;
          friction_tax_return_cents?: number | null;
          friction_tax_platform_cents?: number | null;
          partial_capture_failed?: boolean;
          return_overdue?: boolean;
          full_capture_failed?: boolean;
          manual_reconciliation?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'trades_initiator_id_fkey';
            columns: ['initiator_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trades_counterpart_id_fkey';
            columns: ['counterpart_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trades_initiator_item_id_fkey';
            columns: ['initiator_item_id'];
            isOneToOne: false;
            referencedRelation: 'items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trades_counterpart_item_id_fkey';
            columns: ['counterpart_item_id'];
            isOneToOne: false;
            referencedRelation: 'items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trades_dispute_raised_by_fkey';
            columns: ['dispute_raised_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trades_disputed_against_fkey';
            columns: ['disputed_against'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trades_fraud_victim_id_fkey';
            columns: ['fraud_victim_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      cash_sales: {
        Row: {
          id: string;
          item_id: string;
          buyer_id: string;
          seller_id: string;
          amount_cents: number;
          agreed_price_cents: number;
          platform_fee_cents: number;
          status: Database['cardtrade']['Enums']['cash_sale_status'];
          version: number;
          transfer_id: string | null;
          payment_nonce: string | null;
          payment_requested_at: string | null;
          payment_settled_at: string | null;
          item_title: string;
          item_description: string | null;
          item_condition: string | null;
          item_image_paths: string[];
          fulfillment_method: Database['cardtrade']['Enums']['handover_method'] | null;
          shipping_cost_cents: number;
          shipping_notes: string | null;
          delivery_address: string | null;
          meeting_location: string | null;
          meeting_lat: number | null;
          meeting_lng: number | null;
          meeting_place_id: string | null;
          meeting_at: string | null;
          terms_version: number;
          terms_updated_at: string | null;
          buyer_terms_accepted_version: number | null;
          seller_terms_accepted_version: number | null;
          buyer_terms_accepted_at: string | null;
          seller_terms_accepted_at: string | null;
          tracking_carrier: string | null;
          tracking_number: string | null;
          tracking_url: string | null;
          tracking_status: string | null;
          shipped_at: string | null;
          received_at: string | null;
          inspection_accepted_at: string | null;
          carrier_delivered_at: string | null;
          inspection_deadline_at: string | null;
          auto_completed: boolean;
          buyer_handover_confirmed_at: string | null;
          seller_handover_confirmed_at: string | null;
          completed_at: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          cancel_reason: string | null;
          disputed_at: string | null;
          disputed_by: string | null;
          dispute_reason: string | null;
          dispute_conversation_id: string | null;
          conversation_id: string | null;
          seller_identity_version: string | null;
          seller_legal_entity_name: string | null;
          seller_trading_name: string | null;
          seller_registration_number: string | null;
          seller_organisation_type: string | null;
          seller_identity_verified_at: string | null;
          buyer_seller_identity_confirmed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          item_id: string;
          buyer_id: string;
          seller_id: string;
          amount_cents: number;
          agreed_price_cents: number;
          platform_fee_cents: number;
          status?: Database['cardtrade']['Enums']['cash_sale_status'];
          version?: number;
          transfer_id?: string | null;
          payment_nonce?: string | null;
          payment_requested_at?: string | null;
          payment_settled_at?: string | null;
          item_title: string;
          item_description?: string | null;
          item_condition?: string | null;
          item_image_paths?: string[];
          fulfillment_method?: Database['cardtrade']['Enums']['handover_method'] | null;
          shipping_cost_cents?: number;
          shipping_notes?: string | null;
          delivery_address?: string | null;
          meeting_location?: string | null;
          meeting_lat?: number | null;
          meeting_lng?: number | null;
          meeting_place_id?: string | null;
          meeting_at?: string | null;
          terms_version?: number;
          terms_updated_at?: string | null;
          buyer_terms_accepted_version?: number | null;
          seller_terms_accepted_version?: number | null;
          buyer_terms_accepted_at?: string | null;
          seller_terms_accepted_at?: string | null;
          tracking_carrier?: string | null;
          tracking_number?: string | null;
          tracking_url?: string | null;
          tracking_status?: string | null;
          shipped_at?: string | null;
          received_at?: string | null;
          inspection_accepted_at?: string | null;
          carrier_delivered_at?: string | null;
          inspection_deadline_at?: string | null;
          auto_completed?: boolean;
          buyer_handover_confirmed_at?: string | null;
          seller_handover_confirmed_at?: string | null;
          completed_at?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancel_reason?: string | null;
          disputed_at?: string | null;
          disputed_by?: string | null;
          dispute_reason?: string | null;
          dispute_conversation_id?: string | null;
          conversation_id?: string | null;
          seller_identity_version?: string | null;
          seller_legal_entity_name?: string | null;
          seller_trading_name?: string | null;
          seller_registration_number?: string | null;
          seller_organisation_type?: string | null;
          seller_identity_verified_at?: string | null;
          buyer_seller_identity_confirmed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          item_id?: string;
          buyer_id?: string;
          seller_id?: string;
          amount_cents?: number;
          agreed_price_cents?: number;
          platform_fee_cents?: number;
          status?: Database['cardtrade']['Enums']['cash_sale_status'];
          version?: number;
          transfer_id?: string | null;
          payment_nonce?: string | null;
          payment_requested_at?: string | null;
          payment_settled_at?: string | null;
          item_title?: string;
          item_description?: string | null;
          item_condition?: string | null;
          item_image_paths?: string[];
          fulfillment_method?: Database['cardtrade']['Enums']['handover_method'] | null;
          shipping_cost_cents?: number;
          shipping_notes?: string | null;
          delivery_address?: string | null;
          meeting_location?: string | null;
          meeting_lat?: number | null;
          meeting_lng?: number | null;
          meeting_place_id?: string | null;
          meeting_at?: string | null;
          terms_version?: number;
          terms_updated_at?: string | null;
          buyer_terms_accepted_version?: number | null;
          seller_terms_accepted_version?: number | null;
          buyer_terms_accepted_at?: string | null;
          seller_terms_accepted_at?: string | null;
          tracking_carrier?: string | null;
          tracking_number?: string | null;
          tracking_url?: string | null;
          tracking_status?: string | null;
          shipped_at?: string | null;
          received_at?: string | null;
          inspection_accepted_at?: string | null;
          carrier_delivered_at?: string | null;
          inspection_deadline_at?: string | null;
          auto_completed?: boolean;
          buyer_handover_confirmed_at?: string | null;
          seller_handover_confirmed_at?: string | null;
          completed_at?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancel_reason?: string | null;
          disputed_at?: string | null;
          disputed_by?: string | null;
          dispute_reason?: string | null;
          dispute_conversation_id?: string | null;
          conversation_id?: string | null;
          seller_identity_version?: string | null;
          seller_legal_entity_name?: string | null;
          seller_trading_name?: string | null;
          seller_registration_number?: string | null;
          seller_organisation_type?: string | null;
          seller_identity_verified_at?: string | null;
          buyer_seller_identity_confirmed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'cash_sales_item_id_fkey';
            columns: ['item_id'];
            isOneToOne: false;
            referencedRelation: 'items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cash_sales_buyer_id_fkey';
            columns: ['buyer_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cash_sales_seller_id_fkey';
            columns: ['seller_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cash_sales_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
        ];
      };
      cash_sale_events: {
        Row: {
          id: string;
          cash_sale_id: string;
          actor_id: string | null;
          event: string;
          from_status: Database['cardtrade']['Enums']['cash_sale_status'] | null;
          to_status: Database['cardtrade']['Enums']['cash_sale_status'] | null;
          detail: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          cash_sale_id: string;
          actor_id?: string | null;
          event: string;
          from_status?: Database['cardtrade']['Enums']['cash_sale_status'] | null;
          to_status?: Database['cardtrade']['Enums']['cash_sale_status'] | null;
          detail?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          cash_sale_id?: string;
          actor_id?: string | null;
          event?: string;
          from_status?: Database['cardtrade']['Enums']['cash_sale_status'] | null;
          to_status?: Database['cardtrade']['Enums']['cash_sale_status'] | null;
          detail?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'cash_sale_events_cash_sale_id_fkey';
            columns: ['cash_sale_id'];
            isOneToOne: false;
            referencedRelation: 'cash_sales';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cash_sale_events_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      pre_auth_holds: {
        Row: {
          id: string;
          trade_id: string;
          trader_id: string;
          hold_ref: string | null;
          amount_cents: number;
          captured_cents: number;
          status: Database['cardtrade']['Enums']['hold_status'];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          trade_id: string;
          trader_id: string;
          hold_ref?: string | null;
          amount_cents: number;
          captured_cents?: number;
          status?: Database['cardtrade']['Enums']['hold_status'];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          trade_id?: string;
          trader_id?: string;
          hold_ref?: string | null;
          amount_cents?: number;
          captured_cents?: number;
          status?: Database['cardtrade']['Enums']['hold_status'];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'pre_auth_holds_trade_id_fkey';
            columns: ['trade_id'];
            isOneToOne: false;
            referencedRelation: 'trades';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pre_auth_holds_trader_id_fkey';
            columns: ['trader_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      trade_items: {
        Row: {
          trade_id: string;
          trader_id: string;
          item_id: string;
          created_at: string;
        };
        Insert: {
          trade_id: string;
          trader_id: string;
          item_id: string;
          created_at?: string;
        };
        Update: {
          trade_id?: string;
          trader_id?: string;
          item_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'trade_items_trade_id_fkey';
            columns: ['trade_id'];
            isOneToOne: false;
            referencedRelation: 'trades';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trade_items_item_id_fkey';
            columns: ['item_id'];
            isOneToOne: false;
            referencedRelation: 'items';
            referencedColumns: ['id'];
          },
        ];
      };
      trade_proposal_items: {
        Row: {
          proposal_id: string;
          item_id: string;
          created_at: string;
        };
        Insert: {
          proposal_id: string;
          item_id: string;
          created_at?: string;
        };
        Update: {
          proposal_id?: string;
          item_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'trade_proposal_items_proposal_id_fkey';
            columns: ['proposal_id'];
            isOneToOne: false;
            referencedRelation: 'trade_proposals';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trade_proposal_items_item_id_fkey';
            columns: ['item_id'];
            isOneToOne: false;
            referencedRelation: 'items';
            referencedColumns: ['id'];
          },
        ];
      };
      trade_proposals: {
        Row: {
          id: string;
          proposer_id: string;
          counterpart_id: string;
          proposer_item_id: string;
          counterpart_item_id: string;
          status: Database['cardtrade']['Enums']['trade_proposal_status'];
          message: string | null;
          trade_id: string | null;
          cash_amount_cents: number;
          cash_direction: Database['cardtrade']['Enums']['trade_cash_direction'];
          declared_value_cents: number | null;
          handover_method: Database['cardtrade']['Enums']['handover_method'] | null;
          meeting_location: string | null;
          meeting_lat: number | null;
          meeting_lng: number | null;
          meeting_place_id: string | null;
          meeting_at: string | null;
          delivery_details: string | null;
          delivery_cost_cents: number | null;
          created_at: string;
          responded_at: string | null;
        };
        Insert: {
          id?: string;
          proposer_id: string;
          counterpart_id: string;
          proposer_item_id: string;
          counterpart_item_id: string;
          status?: Database['cardtrade']['Enums']['trade_proposal_status'];
          message?: string | null;
          trade_id?: string | null;
          cash_amount_cents?: number;
          cash_direction?: Database['cardtrade']['Enums']['trade_cash_direction'];
          declared_value_cents?: number | null;
          handover_method?: Database['cardtrade']['Enums']['handover_method'] | null;
          meeting_location?: string | null;
          meeting_lat?: number | null;
          meeting_lng?: number | null;
          meeting_place_id?: string | null;
          meeting_at?: string | null;
          delivery_details?: string | null;
          delivery_cost_cents?: number | null;
          created_at?: string;
          responded_at?: string | null;
        };
        Update: {
          id?: string;
          proposer_id?: string;
          counterpart_id?: string;
          proposer_item_id?: string;
          counterpart_item_id?: string;
          status?: Database['cardtrade']['Enums']['trade_proposal_status'];
          message?: string | null;
          trade_id?: string | null;
          cash_amount_cents?: number;
          cash_direction?: Database['cardtrade']['Enums']['trade_cash_direction'];
          declared_value_cents?: number | null;
          handover_method?: Database['cardtrade']['Enums']['handover_method'] | null;
          meeting_location?: string | null;
          meeting_lat?: number | null;
          meeting_lng?: number | null;
          meeting_place_id?: string | null;
          meeting_at?: string | null;
          delivery_details?: string | null;
          delivery_cost_cents?: number | null;
          created_at?: string;
          responded_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'trade_proposals_proposer_id_fkey';
            columns: ['proposer_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trade_proposals_counterpart_id_fkey';
            columns: ['counterpart_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trade_proposals_proposer_item_id_fkey';
            columns: ['proposer_item_id'];
            isOneToOne: false;
            referencedRelation: 'items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trade_proposals_counterpart_item_id_fkey';
            columns: ['counterpart_item_id'];
            isOneToOne: false;
            referencedRelation: 'items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trade_proposals_trade_id_fkey';
            columns: ['trade_id'];
            isOneToOne: false;
            referencedRelation: 'trades';
            referencedColumns: ['id'];
          },
        ];
      };
      trade_state_transitions: {
        Row: {
          id: string;
          trade_id: string;
          from_state: Database['cardtrade']['Enums']['trade_state'];
          to_state: Database['cardtrade']['Enums']['trade_state'];
          requested_by: string | null;
          event: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          trade_id: string;
          from_state: Database['cardtrade']['Enums']['trade_state'];
          to_state: Database['cardtrade']['Enums']['trade_state'];
          requested_by?: string | null;
          event: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          trade_id?: string;
          from_state?: Database['cardtrade']['Enums']['trade_state'];
          to_state?: Database['cardtrade']['Enums']['trade_state'];
          requested_by?: string | null;
          event?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'trade_state_transitions_trade_id_fkey';
            columns: ['trade_id'];
            isOneToOne: false;
            referencedRelation: 'trades';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'trade_state_transitions_requested_by_fkey';
            columns: ['requested_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      webhook_logs: {
        Row: {
          id: string;
          event_id: string;
          event_type: string;
          payload: Json;
          outcome: Database['cardtrade']['Enums']['webhook_outcome'];
          trade_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          event_type: string;
          payload: Json;
          outcome: Database['cardtrade']['Enums']['webhook_outcome'];
          trade_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          event_type?: string;
          payload?: Json;
          outcome?: Database['cardtrade']['Enums']['webhook_outcome'];
          trade_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'webhook_logs_trade_id_fkey';
            columns: ['trade_id'];
            isOneToOne: false;
            referencedRelation: 'trades';
            referencedColumns: ['id'];
          },
        ];
      };
      watchlist: {
        Row: {
          user_id: string;
          item_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          item_id: string;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          item_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          type: Database['cardtrade']['Enums']['notification_type'];
          title: string;
          body: string | null;
          link: string | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type?: Database['cardtrade']['Enums']['notification_type'];
          title: string;
          body?: string | null;
          link?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          type?: Database['cardtrade']['Enums']['notification_type'];
          title?: string;
          body?: string | null;
          link?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      deals: {
        Row: {
          id: string;
          creator_id: string;
          counterparty_id: string | null;
          share_token: string;
          joined_at: string | null;
          state: Database['cardtrade']['Enums']['deal_state'];
          version: number;
          title: string;
          description: string | null;
          creator_role: Database['cardtrade']['Enums']['deal_role'] | null;
          creator_offer_kinds: string[];
          creator_photo_paths: string[];
          counterparty_photo_paths: string[];
          creator_item_id: string | null;
          counterparty_item_id: string | null;
          creator_item_text: string | null;
          counterparty_item_text: string | null;
          cash_amount_cents: number | null;
          cash_payer_id: string | null;
          handover_method: Database['cardtrade']['Enums']['handover_method'] | null;
          meeting_location: string | null;
          meeting_lat: number | null;
          meeting_lng: number | null;
          meeting_place_id: string | null;
          meeting_at: string | null;
          delivery_details: string | null;
          delivery_cost_cents: number | null;
          terms_updated_at: string | null;
          creator_confirmed_at: string | null;
          counterparty_confirmed_at: string | null;
          collateral_cents: number | null;
          cancelled_by: string | null;
          cancel_reason: string | null;
          /** The deal's participant-only chat thread (0013). */
          conversation_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          creator_id: string;
          counterparty_id?: string | null;
          share_token?: string;
          joined_at?: string | null;
          state?: Database['cardtrade']['Enums']['deal_state'];
          version?: number;
          title: string;
          description?: string | null;
          creator_role?: Database['cardtrade']['Enums']['deal_role'] | null;
          creator_offer_kinds?: string[];
          creator_photo_paths?: string[];
          counterparty_photo_paths?: string[];
          creator_item_id?: string | null;
          counterparty_item_id?: string | null;
          creator_item_text?: string | null;
          counterparty_item_text?: string | null;
          cash_amount_cents?: number | null;
          cash_payer_id?: string | null;
          handover_method?: Database['cardtrade']['Enums']['handover_method'] | null;
          meeting_location?: string | null;
          meeting_lat?: number | null;
          meeting_lng?: number | null;
          meeting_place_id?: string | null;
          meeting_at?: string | null;
          delivery_details?: string | null;
          delivery_cost_cents?: number | null;
          terms_updated_at?: string | null;
          creator_confirmed_at?: string | null;
          counterparty_confirmed_at?: string | null;
          collateral_cents?: number | null;
          cancelled_by?: string | null;
          cancel_reason?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          creator_id?: string;
          counterparty_id?: string | null;
          share_token?: string;
          joined_at?: string | null;
          state?: Database['cardtrade']['Enums']['deal_state'];
          version?: number;
          title?: string;
          description?: string | null;
          creator_role?: Database['cardtrade']['Enums']['deal_role'] | null;
          creator_offer_kinds?: string[];
          creator_photo_paths?: string[];
          counterparty_photo_paths?: string[];
          creator_item_id?: string | null;
          counterparty_item_id?: string | null;
          creator_item_text?: string | null;
          counterparty_item_text?: string | null;
          cash_amount_cents?: number | null;
          cash_payer_id?: string | null;
          handover_method?: Database['cardtrade']['Enums']['handover_method'] | null;
          meeting_location?: string | null;
          meeting_lat?: number | null;
          meeting_lng?: number | null;
          meeting_place_id?: string | null;
          meeting_at?: string | null;
          delivery_details?: string | null;
          delivery_cost_cents?: number | null;
          terms_updated_at?: string | null;
          creator_confirmed_at?: string | null;
          counterparty_confirmed_at?: string | null;
          collateral_cents?: number | null;
          cancelled_by?: string | null;
          cancel_reason?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      deal_events: {
        Row: {
          id: string;
          deal_id: string;
          actor_id: string | null;
          event: string;
          from_state: Database['cardtrade']['Enums']['deal_state'] | null;
          to_state: Database['cardtrade']['Enums']['deal_state'] | null;
          detail: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          deal_id: string;
          actor_id?: string | null;
          event: string;
          from_state?: Database['cardtrade']['Enums']['deal_state'] | null;
          to_state?: Database['cardtrade']['Enums']['deal_state'] | null;
          detail?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          deal_id?: string;
          actor_id?: string | null;
          event?: string;
          from_state?: Database['cardtrade']['Enums']['deal_state'] | null;
          to_state?: Database['cardtrade']['Enums']['deal_state'] | null;
          detail?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      deal_holds: {
        Row: {
          id: string;
          deal_id: string;
          party_id: string;
          hold_ref: string | null;
          amount_cents: number;
          captured_cents: number;
          status: Database['cardtrade']['Enums']['hold_status'];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          deal_id: string;
          party_id: string;
          hold_ref?: string | null;
          amount_cents: number;
          captured_cents?: number;
          status?: Database['cardtrade']['Enums']['hold_status'];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          deal_id?: string;
          party_id?: string;
          hold_ref?: string | null;
          amount_cents?: number;
          captured_cents?: number;
          status?: Database['cardtrade']['Enums']['hold_status'];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      reports: {
        Row: {
          id: string;
          reporter_id: string;
          target_type: string;
          target_id: string;
          reason: string;
          details: string | null;
          status: Database['cardtrade']['Enums']['report_status'];
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          reporter_id: string;
          target_type: string;
          target_id: string;
          reason: string;
          details?: string | null;
          status?: Database['cardtrade']['Enums']['report_status'];
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          reporter_id?: string;
          target_type?: string;
          target_id?: string;
          reason?: string;
          details?: string | null;
          status?: Database['cardtrade']['Enums']['report_status'];
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      reviews: {
        Row: {
          id: string;
          reviewer_id: string;
          reviewee_id: string;
          rating: number;
          comment: string | null;
          source_type: string;
          source_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          reviewer_id: string;
          reviewee_id: string;
          rating: number;
          comment?: string | null;
          source_type: string;
          source_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          reviewer_id?: string;
          reviewee_id?: string;
          rating?: number;
          comment?: string | null;
          source_type?: string;
          source_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      offers: {
        Row: {
          id: string;
          item_id: string;
          seller_id: string;
          buyer_id: string;
          offered_by: string;
          amount_cents: number;
          status: Database['cardtrade']['Enums']['offer_status'];
          parent_offer_id: string | null;
          message: string | null;
          seller_identity_version: string | null;
          buyer_seller_identity_confirmed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          item_id: string;
          seller_id: string;
          buyer_id: string;
          offered_by: string;
          amount_cents: number;
          status?: Database['cardtrade']['Enums']['offer_status'];
          parent_offer_id?: string | null;
          message?: string | null;
          seller_identity_version?: string | null;
          buyer_seller_identity_confirmed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          item_id?: string;
          seller_id?: string;
          buyer_id?: string;
          offered_by?: string;
          amount_cents?: number;
          status?: Database['cardtrade']['Enums']['offer_status'];
          parent_offer_id?: string | null;
          message?: string | null;
          seller_identity_version?: string | null;
          buyer_seller_identity_confirmed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          item_id: string | null;
          /** Set when this thread belongs to a private deal (0013). */
          deal_id: string | null;
          /** Set when this thread belongs to a 2-way trade (0016). */
          trade_id: string | null;
          /** Set when this thread is the arbitration chat for a dispute (0019). */
          cash_sale_id: string | null;
          participant_a: string;
          participant_b: string;
          last_message_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          item_id?: string | null;
          deal_id?: string | null;
          trade_id?: string | null;
          cash_sale_id?: string | null;
          participant_a: string;
          participant_b: string;
          last_message_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          item_id?: string | null;
          deal_id?: string | null;
          trade_id?: string | null;
          cash_sale_id?: string | null;
          participant_a?: string;
          participant_b?: string;
          last_message_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          /** Null for a SYSTEM message mirrored from a contract event. */
          sender_id: string | null;
          kind: 'USER' | 'SYSTEM';
          system_event: string | null;
          body: string;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id?: string | null;
          kind?: 'USER' | 'SYSTEM';
          system_event?: string | null;
          body: string;
          read_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          sender_id?: string | null;
          kind?: 'USER' | 'SYSTEM';
          system_event?: string | null;
          body?: string;
          read_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      public_profiles: {
        Row: {
          id: string;
          display_name: string;
          rating: number | null;
          rating_count: number;
          is_verified: boolean;
        };
        Relationships: [];
      };
    };
    Functions: {
      create_cash_sale_agreement: {
        Args: {
          p_item_id: string;
          p_buyer_id: string;
          p_agreed_price_cents: number;
          p_platform_fee_cents: number;
          p_seller_identity_version: string;
          p_seller_legal_entity_name: string;
          p_seller_trading_name: string | null;
          p_seller_registration_number: string;
          p_seller_organisation_type: string | null;
          p_seller_identity_verified_at: string;
          p_buyer_identity_confirmed_at: string;
        };
        Returns: Database['cardtrade']['Tables']['cash_sales']['Row'][];
      };
      attach_cash_sale_conversation: {
        Args: {
          p_cash_sale_id: string;
          p_actor_id: string;
        };
        Returns: string | null;
      };
      attach_dispute_conversation: {
        Args: {
          p_cash_sale_id: string;
          p_actor_id: string;
        };
        Returns: undefined;
      };
      ensure_deal_conversation: {
        Args: {
          p_deal_id: string;
          p_actor_id: string;
        };
        Returns: string | null;
      };
      ensure_trade_conversation: {
        Args: {
          p_trade_id: string;
          p_actor_id: string;
        };
        Returns: string | null;
      };
      finalize_trade_acceptance: {
        Args: {
          p_proposal_id: string;
          p_trade_id: string;
          p_actor_id: string;
          p_initiator_id: string;
          p_initiator_item_id: string;
          p_initiator_extra_item_ids: string[];
          p_counterpart_item_id: string;
          p_cash_amount_cents: number;
          p_cash_direction: Database['cardtrade']['Enums']['trade_cash_direction'];
          p_handover_method?: Database['cardtrade']['Enums']['handover_method'] | null;
          p_meeting_location?: string | null;
          p_meeting_lat?: number | null;
          p_meeting_lng?: number | null;
          p_meeting_place_id?: string | null;
          p_meeting_at?: string | null;
          p_delivery_details?: string | null;
          p_delivery_cost_cents?: number | null;
        };
        Returns: Database['cardtrade']['Tables']['trade_proposals']['Row'];
      };
      apply_cash_sale_tracking: {
        Args: {
          p_cash_sale_id: string;
          p_tracking_status: string;
          p_delivered_at?: string;
        };
        Returns: Database['cardtrade']['Tables']['cash_sales']['Row'][];
      };
      auto_complete_due_cash_sales: {
        Args: Record<string, never>;
        Returns: number;
      };
      member_sale_stats: {
        Args: { p_profile_id: string };
        Returns: {
          completed_sales: number;
          completed_purchases: number;
        }[];
      };
    };
    Enums: {
      kyc_status: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
      merchant_status: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
      item_status: 'AVAILABLE' | 'RESERVED' | 'SOLD';
      trade_proposal_status:
        | 'PENDING'
        | 'ACCEPTED'
        | 'DECLINED'
        | 'WITHDRAWN'
        | 'SUPERSEDED';
      trade_cash_direction: 'PROPOSER_PAYS' | 'COUNTERPART_PAYS';
      trade_state:
        | 'COLLATERAL_PENDING'
        | 'COLLATERAL_LOCKED'
        | 'IN_TRANSIT'
        | 'INSPECTION'
        | 'COMPLETED'
        | 'DISPUTED'
        | 'FRAUD_RESOLVED';
      cash_sale_status:
        | 'AGREEMENT'
        | 'PAYMENT_PENDING'
        | 'ESCROW_HELD'
        | 'IN_TRANSIT'
        | 'HANDOVER'
        | 'INSPECTION'
        | 'COMPLETED'
        | 'DISPUTED'
        | 'CANCELLED'
        | 'FAILED'
        | 'REFUNDED';
      hold_status: 'ACTIVE' | 'VOIDED' | 'PARTIALLY_CAPTURED' | 'FULLY_CAPTURED' | 'FAILED';
      webhook_outcome: 'SUCCESS' | 'FAILURE' | 'NO_OP';
      offer_status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'COUNTERED' | 'WITHDRAWN';
      notification_type: 'OFFER' | 'MESSAGE' | 'TRADE' | 'SALE' | 'SYSTEM';
      report_status: 'OPEN' | 'ACTIONED' | 'DISMISSED';
      deal_state:
        | 'INVITED'
        | 'TERMS'
        | 'CONFIRMATION'
        | 'ESCROW_PENDING'
        | 'ESCROW_LOCKED'
        | 'COMPLETED'
        | 'CANCELLED'
        | 'DISPUTED';
      handover_method: 'IN_PERSON' | 'DELIVERY';
      deal_role: 'BUYER' | 'SELLER' | 'TRADER';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

// ---------------------------------------------------------------------------
// Typed helper aliases
//
// These mirror the ergonomic helpers shipped with the Supabase generator so
// call sites can write `Tables<'items'>` instead of the long indexed access.
// ---------------------------------------------------------------------------

type PublicSchema = Database['cardtrade'];

export type Tables<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Row'];

export type TablesInsert<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Insert'];

export type TablesUpdate<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Update'];

export type Enums<T extends keyof PublicSchema['Enums']> =
  PublicSchema['Enums'][T];
