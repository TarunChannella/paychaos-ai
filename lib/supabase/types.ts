/**
 * Phase 1C-A/2B — minimal Supabase `Database` type.
 *
 * Scoped EXACTLY to the three tables the approved Phase 1 migration creates
 * (`orders`, `payment_attempts`, `fulfilments` — see docs/DATABASE.md
 * Sections 9/10/12 and supabase/migrations/20260823000000_phase1_foundation_schema.sql),
 * plus the Phase 2B additive `payment_attempts.razorpay_order_id` /
 * `razorpay_order_status` columns
 * (supabase/migrations/20260824000000_phase2b_payment_attempts_razorpay_correlation.sql).
 *
 * Do NOT add Phase 2+ tables here (`payments`, `webhook_events`,
 * `event_processing_attempts`, `chaos_runs`, `invariant_results`,
 * `findings`, `regression_runs`) — those are created and typed by the
 * phases that own them.
 *
 * `fulfilments` intentionally has no `payment_id` /
 * `trigger_processing_attempt_id` fields here — those columns do not exist
 * until Phase 2 additive migrations (docs/DATABASE.md "Column Phasing
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
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
