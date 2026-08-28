/**
 * Phase 1C-A/2B/2C/2D/2E/2F/3B — minimal Supabase `Database` type.
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
 * (supabase/migrations/20260826000000_phase2d_webhook_events.sql), the
 * Phase 2E additive `event_processing_attempts` table plus the
 * `record_webhook_duplicate_delivery` RPC
 * (supabase/migrations/20260827000000_phase2e_webhook_dedup.sql), the
 * Phase 2F additive `fulfilments.payment_id` /
 * `fulfilments.trigger_processing_attempt_id` columns plus the
 * `process_webhook_payment_event` RPC
 * (supabase/migrations/20260828000000_phase2f_merchant_processing.sql), and
 * the Phase 3B additive `chaos_runs` table
 * (supabase/migrations/20260829000000_phase3b_chaos_runs.sql), and the
 * Phase 3C additive `event_processing_attempts.chaos_run_id` column plus
 * widened `source_kind` (supabase/migrations/20260830000000_phase3c_controlled_replay.sql
 * — NOT YET APPLIED to the remote project; this type describes it in
 * advance so `lib/chaos/replay-repository.ts` can be written and
 * unit-tested against a mocked client before the migration is manually
 * reviewed and applied).
 *
 * Do NOT add Phase 3C+ tables here (`invariant_results`, `findings`,
 * `regression_runs`) — those are created and typed by the phases that own
 * them. `event_processing_attempts.source_kind` here is deliberately
 * scoped to exactly the two values the current CHECK constraint allows
 * (`REAL_RAZORPAY_WEBHOOK`, `PAYCHAOS_REPLAY`) — NOT the full four-value
 * approved-target vocabulary docs/DATABASE.md Section 14 documents.
 * `PAYCHAOS_SIMULATION`/`TEST_FIXTURE` remain unimplemented surface until
 * their own later phases; adding them to this type would misrepresent what
 * the database will currently accept.
 *
 * Phase 3E-A adds the additive `event_processing_attempts.state_before` /
 * `state_after` evidence-snapshot columns
 * (supabase/migrations/20260901000000_phase3e_evidence_snapshots.sql — NOT
 * YET APPLIED to the remote project; this type describes them in advance so
 * `lib/evidence/evidence-repository.ts` can be written and unit-tested
 * against a mocked client before the migration is manually reviewed and
 * applied, exactly as was done for the Phase 3C `chaos_run_id` column).
 * `event_processing_attempts` still excludes `fault_action` — that remains a
 * later, separate additive column (docs/DATABASE.md Section 14 "Phase
 * Ownership"); Phase 3E-A deliberately does not introduce unused schema
 * surface for it.
 *
 * `state_before`/`state_after` are typed `Record<string, unknown> | null`,
 * matching this file's existing convention for every other JSONB column
 * (`normalized_event`, `raw_payload_redacted`, `fault_config`,
 * `fault_state`) — this project has never generated a Supabase `Json` union
 * type, and the database CHECK constraints
 * `event_processing_attempts_state_before_is_object` /
 * `..._state_after_is_object` restrict these columns to a JSON object or
 * NULL anyway, so the object-shaped TypeScript type is the accurate one.
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

/**
 * Phase 3C — the currently-persistable subset of `source_kind`, matching
 * the current `event_processing_attempts_source_kind_valid` CHECK exactly.
 * `PAYCHAOS_SIMULATION`/`TEST_FIXTURE` are approved future target values
 * (docs/DATABASE.md Section 14) but are deliberately excluded here — the
 * database does not currently accept them.
 */
export type EventProcessingAttemptSourceKind =
  "REAL_RAZORPAY_WEBHOOK" | "PAYCHAOS_REPLAY";

/** Phase 3B — frozen P0 scenario catalogue, matching lib/chaos/types.ts's ChaosScenarioId exactly. */
export type ChaosRunScenarioId = "C01" | "C03" | "C07" | "C11";

export type ChaosRunStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export type ChaosRunOutcome = "PASS" | "FAIL" | "UNKNOWN" | "BLOCKED" | "ERROR";

/** Phase 3B — the three P0 fault primitives, matching lib/chaos/types.ts's ChaosFaultType exactly. NULL for C11, which has none. */
export type ChaosRunFaultType =
  "REPLAY_EVENT" | "INVALID_SIGNATURE_TEST" | "DROP_CLIENT_CONFIRMATION";

/** Phase 3B — the ten official Chaos Run Precheck IDs, matching lib/chaos/types.ts's ChaosPrecheckId exactly. */
export type ChaosRunFailedPrecheckId =
  | "PRECHECK-01"
  | "PRECHECK-02"
  | "PRECHECK-03"
  | "PRECHECK-04"
  | "PRECHECK-05"
  | "PRECHECK-06"
  | "PRECHECK-07"
  | "PRECHECK-08"
  | "PRECHECK-09"
  | "PRECHECK-10";

export type ChaosRunDataClassification =
  "RECORDED_TEST_EVIDENCE" | "SYNTHETIC_DEMO";

/**
 * Phase 3D-0 — the only execution-time PRE-SEC-xxx block currently
 * supported (docs/SECURITY.md), matching
 * `chaos_runs_execution_block_code_valid` exactly. Distinct from
 * `ChaosRunFailedPrecheckId` (a Phase 3A creation-time PRECHECK-01..10
 * block). PRE-SEC-010/011 are deliberately excluded — see this migration's
 * own column comment in
 * supabase/migrations/20260831000000_phase3d_execution_safety.sql.
 */
export type ChaosRunExecutionBlockCode = "PRE-SEC-007";

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
          chaos_run_id: string | null;
          source_kind: EventProcessingAttemptSourceKind;
          is_duplicate_delivery: boolean;
          status: EventProcessingAttemptStatus;
          normalized_event: Record<string, unknown>;
          state_before: Record<string, unknown> | null;
          state_after: Record<string, unknown> | null;
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
          chaos_run_id?: string | null;
          source_kind?: EventProcessingAttemptSourceKind;
          is_duplicate_delivery?: boolean;
          status?: EventProcessingAttemptStatus;
          normalized_event?: Record<string, unknown>;
          state_before?: Record<string, unknown> | null;
          state_after?: Record<string, unknown> | null;
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
          chaos_run_id?: string | null;
          source_kind?: EventProcessingAttemptSourceKind;
          is_duplicate_delivery?: boolean;
          status?: EventProcessingAttemptStatus;
          normalized_event?: Record<string, unknown>;
          state_before?: Record<string, unknown> | null;
          state_after?: Record<string, unknown> | null;
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
          {
            foreignKeyName: "event_processing_attempts_chaos_run_id_fkey";
            columns: ["chaos_run_id"];
            isOneToOne: false;
            referencedRelation: "chaos_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      fulfilments: {
        Row: {
          id: string;
          order_id: string;
          payment_id: string;
          trigger_processing_attempt_id: string | null;
          effect_type: FulfilmentEffectType;
          idempotency_key: string;
          applied_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          payment_id: string;
          trigger_processing_attempt_id?: string | null;
          effect_type?: FulfilmentEffectType;
          idempotency_key: string;
          applied_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          payment_id?: string;
          trigger_processing_attempt_id?: string | null;
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
          {
            foreignKeyName: "fulfilments_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fulfilments_trigger_processing_attempt_id_fkey";
            columns: ["trigger_processing_attempt_id"];
            isOneToOne: false;
            referencedRelation: "event_processing_attempts";
            referencedColumns: ["id"];
          },
        ];
      };
      chaos_runs: {
        Row: {
          id: string;
          scenario_id: ChaosRunScenarioId;
          order_id: string | null;
          payment_attempt_id: string | null;
          payment_id: string | null;
          source_webhook_event_id: string | null;
          status: ChaosRunStatus;
          outcome: ChaosRunOutcome | null;
          fault_type: ChaosRunFaultType | null;
          failed_precheck_id: ChaosRunFailedPrecheckId | null;
          execution_block_code: ChaosRunExecutionBlockCode | null;
          fault_config: Record<string, unknown>;
          fault_state: Record<string, unknown>;
          data_classification: ChaosRunDataClassification;
          error_message_redacted: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          scenario_id: ChaosRunScenarioId;
          order_id?: string | null;
          payment_attempt_id?: string | null;
          payment_id?: string | null;
          source_webhook_event_id?: string | null;
          status?: ChaosRunStatus;
          outcome?: ChaosRunOutcome | null;
          fault_type?: ChaosRunFaultType | null;
          failed_precheck_id?: ChaosRunFailedPrecheckId | null;
          execution_block_code?: ChaosRunExecutionBlockCode | null;
          fault_config?: Record<string, unknown>;
          fault_state?: Record<string, unknown>;
          // Required, NOT optional: the database column has NO DEFAULT
          // (architect correction — fail-closed provenance handling). Every
          // insert must supply this explicitly; there is no server-side or
          // TypeScript-level fallback.
          data_classification: ChaosRunDataClassification;
          error_message_redacted?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          scenario_id?: ChaosRunScenarioId;
          order_id?: string | null;
          payment_attempt_id?: string | null;
          payment_id?: string | null;
          source_webhook_event_id?: string | null;
          status?: ChaosRunStatus;
          outcome?: ChaosRunOutcome | null;
          fault_type?: ChaosRunFaultType | null;
          failed_precheck_id?: ChaosRunFailedPrecheckId | null;
          execution_block_code?: ChaosRunExecutionBlockCode | null;
          fault_config?: Record<string, unknown>;
          fault_state?: Record<string, unknown>;
          data_classification?: ChaosRunDataClassification;
          error_message_redacted?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chaos_runs_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chaos_runs_payment_attempt_id_fkey";
            columns: ["payment_attempt_id"];
            isOneToOne: false;
            referencedRelation: "payment_attempts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chaos_runs_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chaos_runs_source_webhook_event_id_fkey";
            columns: ["source_webhook_event_id"];
            isOneToOne: false;
            referencedRelation: "webhook_events";
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
      process_webhook_payment_event: {
        Args: { p_processing_attempt_id: string };
        Returns: Record<string, unknown>;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
