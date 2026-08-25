/**
 * Phase 1C-A/2B/2C/2D/2E — minimal Supabase `Database` type.
 *
 * Scoped EXACTLY to the tables that exist after the approved Phase 1
 * migration (`orders`, `payment_attempts`, `fulfilments` — see
 * docs/DATABASE.md Sections 9/10/12 and
 * supabase/migrations/20260823000000_phase1_foundation_schema.sql), the
 * Phase 2B additive `payment_attempts.razorpay_order_id` /
 * `razorpay_order_status` columns
 * (supabase/migrations/20260824000000_phase2b_payment_attempts_razorpay_correlation.sql),
 * the Phase 2C additive `payments` table
 * (supabase/migrations/20260825000000_phase2c_payments.sql), the
 * Phase 2D additive `webhook_events` table
 * (supabase/migrations/20260826000000_phase2d_webhook_events.sql), and the
 * Phase 2E additive `event_processing_attempts` table plus the
 * `record_webhook_duplicate_delivery` RPC
 * (supabase/migrations/20260827000000_phase2e_webhook_dedup.sql).
 *
 * Do NOT add Phase 2F+ tables here (`chaos_runs`, `invariant_results`,
 * `findings`, `regression_runs`) — those are created and typed by the
 * phases that own them. `event_processing_attempts` here is deliberately
 * the Phase 2 SUBSET ONLY — no `chaos_run_id`/`fault_action`/
 * `state_before`/`state_after` (docs/DATABASE.md Section 14 "Phase
 * Ownership" pre-approves those as later, separate additive columns).
 *
 * `fulfilments` intentionally has no `payment_id` /
 * `trigger_processing_attempt_id` fields here — those columns do not exist
 * until a later additive migration (docs/DATABASE.md "Column Phasing
 * Note" on the `fulfilments` table).
 *
 * This type only describes shape for `createClient<Database>()`. It is not
 * itself a migration and does not create/alter anything.
 */

export type OrderPaymentStatus =
  "UNPAID" | "PENDING" | "FAILED_OBSERVED" | "PAID";
export type OrderBusinessStatus = "OPEN" | "FULFILLED";

export type PaymentAttemptStatus =
  | "CREATED"
  | "ORDER_CREATED"
  | "CHECKOUT_IN_PROGRESS"
  | "FAILED_OBSERVED"
  | "CAPTURED";

export type FulfilmentEffectType = "FULFIL_ORDER";

export type EventProcessingAttemptStatus =
  | "PENDING"
  | "HELD"
  | "PROCESSING"
  | "SUCCEEDED"
  | "FAILED"
  | "SKIPPED_DUPLICATE";

export interface Database {
  public: {
    Tables: {
      orders: {
        Row: {
          id: string;
          amount_subunits: number;
          currency: string;
          payment_status: OrderPaymentStatus;
          business_status: OrderBusinessStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          amount_subunits: number;
          currency?: string;
          payment_status?: OrderPaymentStatus;
          business_status?: OrderBusinessStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          amount_subunits?: number;
          currency?: string;
          payment_status?: OrderPaymentStatus;
          business_status?: OrderBusinessStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      payment_attempts: {
        Row: {
          id: string;
          order_id: string;
          attempt_no: number;
          amount_subunits: number;
          currency: string;
          status: PaymentAttemptStatus;
          razorpay_receipt: string;
          razorpay_order_id: string | null;
          razorpay_order_status: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          attempt_no: number;
          amount_subunits: number;
          currency?: string;
          status?: PaymentAttemptStatus;
          razorpay_receipt: string;
          razorpay_order_id?: string | null;
          razorpay_order_status?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          attempt_no?: number;
          amount_subunits?: number;
          currency?: string;
          status?: PaymentAttemptStatus;
          razorpay_receipt?: string;
          razorpay_order_id?: string | null;
          razorpay_order_status?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_attempts_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          id: string;
          payment_attempt_id: string;
          razorpay_payment_id: string;
          razorpay_payment_status: string | null;
          amount_subunits: number;
          currency: string;
          checkout_signature_verified: boolean;
          checkout_verified_at: string | null;
          first_observed_at: string;
          last_observed_at: string;
          captured_at: string | null;
          failed_at: string | null;
          error_code: string | null;
          error_description_redacted: string | null;
          error_source: string | null;
          error_step: string | null;
          error_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          payment_attempt_id: string;
          razorpay_payment_id: string;
          razorpay_payment_status?: string | null;
          amount_subunits: number;
          currency?: string;
          checkout_signature_verified?: boolean;
          checkout_verified_at?: string | null;
          first_observed_at?: string;
          last_observed_at?: string;
          captured_at?: string | null;
          failed_at?: string | null;
          error_code?: string | null;
          error_description_redacted?: string | null;
          error_source?: string | null;
          error_step?: string | null;
          error_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          payment_attempt_id?: string;
          razorpay_payment_id?: string;
          razorpay_payment_status?: string | null;
          amount_subunits?: number;
          currency?: string;
          checkout_signature_verified?: boolean;
          checkout_verified_at?: string | null;
          first_observed_at?: string;
          last_observed_at?: string;
          captured_at?: string | null;
          failed_at?: string | null;
          error_code?: string | null;
          error_description_redacted?: string | null;
          error_source?: string | null;
          error_step?: string | null;
          error_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_payment_attempt_id_fkey";
            columns: ["payment_attempt_id"];
            isOneToOne: false;
            referencedRelation: "payment_attempts";
            referencedColumns: ["id"];
          },
        ];
      };
      webhook_events: {
        Row: {
          id: string;
          razorpay_event_id: string;
          event_type: string;
          source_kind: "REAL_RAZORPAY_WEBHOOK";
          razorpay_order_id: string | null;
          razorpay_payment_id: string | null;
          payment_attempt_id: string | null;
          payment_id: string | null;
          signature_verified: boolean;
          received_at: string;
          provider_created_at: string | null;
          amount_subunits: number | null;
          currency: string | null;
          razorpay_payment_status: string | null;
          raw_body_sha256: string;
          raw_payload_redacted: Record<string, unknown>;
          processing_status: "RECEIVED" | "PROCESSING" | "PROCESSED" | "FAILED";
          processed_at: string | null;
          duplicate_delivery_count: number;
          updated_at: string;
        };
        Insert: {
          id?: string;
          razorpay_event_id: string;
          event_type: string;
          source_kind?: "REAL_RAZORPAY_WEBHOOK";
          razorpay_order_id?: string | null;
          razorpay_payment_id?: string | null;
          payment_attempt_id?: string | null;
          payment_id?: string | null;
          signature_verified: boolean;
          received_at?: string;
          provider_created_at?: string | null;
          amount_subunits?: number | null;
          currency?: string | null;
          razorpay_payment_status?: string | null;
          raw_body_sha256: string;
          raw_payload_redacted?: Record<string, unknown>;
          processing_status?:
            "RECEIVED" | "PROCESSING" | "PROCESSED" | "FAILED";
          processed_at?: string | null;
          duplicate_delivery_count?: number;
          updated_at?: string;
        };
        Update: {
          id?: string;
          razorpay_event_id?: string;
          event_type?: string;
          source_kind?: "REAL_RAZORPAY_WEBHOOK";
          razorpay_order_id?: string | null;
          razorpay_payment_id?: string | null;
          payment_attempt_id?: string | null;
          payment_id?: string | null;
          signature_verified?: boolean;
          received_at?: string;
          provider_created_at?: string | null;
          amount_subunits?: number | null;
          currency?: string | null;
          razorpay_payment_status?: string | null;
          raw_body_sha256?: string;
          raw_payload_redacted?: Record<string, unknown>;
          processing_status?:
            "RECEIVED" | "PROCESSING" | "PROCESSED" | "FAILED";
          processed_at?: string | null;
          duplicate_delivery_count?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "webhook_events_payment_attempt_id_fkey";
            columns: ["payment_attempt_id"];
            isOneToOne: false;
            referencedRelation: "payment_attempts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "webhook_events_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
        ];
      };
      event_processing_attempts: {
        Row: {
          id: string;
          webhook_event_id: string | null;
          payment_attempt_id: string | null;
          payment_id: string | null;
          source_kind: "REAL_RAZORPAY_WEBHOOK";
          is_duplicate_delivery: boolean;
          status: EventProcessingAttemptStatus;
          normalized_event: Record<string, unknown>;
          error_code: string | null;
          error_message_redacted: string | null;
          started_at: string;
          finished_at: string | null;
        };
        Insert: {
          id?: string;
          webhook_event_id?: string | null;
          payment_attempt_id?: string | null;
          payment_id?: string | null;
          source_kind?: "REAL_RAZORPAY_WEBHOOK";
          is_duplicate_delivery?: boolean;
          status?: EventProcessingAttemptStatus;
          normalized_event?: Record<string, unknown>;
          error_code?: string | null;
          error_message_redacted?: string | null;
          started_at?: string;
          finished_at?: string | null;
        };
        Update: {
          id?: string;
          webhook_event_id?: string | null;
          payment_attempt_id?: string | null;
          payment_id?: string | null;
          source_kind?: "REAL_RAZORPAY_WEBHOOK";
          is_duplicate_delivery?: boolean;
          status?: EventProcessingAttemptStatus;
          normalized_event?: Record<string, unknown>;
          error_code?: string | null;
          error_message_redacted?: string | null;
          started_at?: string;
          finished_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "event_processing_attempts_webhook_event_id_fkey";
            columns: ["webhook_event_id"];
            isOneToOne: false;
            referencedRelation: "webhook_events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_processing_attempts_payment_attempt_id_fkey";
            columns: ["payment_attempt_id"];
            isOneToOne: false;
            referencedRelation: "payment_attempts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_processing_attempts_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
        ];
      };
      fulfilments: {
        Row: {
          id: string;
          order_id: string;
          effect_type: FulfilmentEffectType;
          idempotency_key: string;
          applied_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          effect_type?: FulfilmentEffectType;
          idempotency_key: string;
          applied_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          effect_type?: FulfilmentEffectType;
          idempotency_key?: string;
          applied_at?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fulfilments_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      record_webhook_duplicate_delivery: {
        Args: { p_razorpay_event_id: string };
        Returns: Database["public"]["Tables"]["webhook_events"]["Row"];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
