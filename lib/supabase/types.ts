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
 * Phase 3F-A adds the additive `invariant_results` table
 * (supabase/migrations/20260902000000_phase3f_invariant_results.sql — applied
 * to the remote project during the Phase 3F-A real-verification round). Its
 * `Update` member is typed `never` on purpose — the migration grants no
 * UPDATE privilege to any role, because a persisted invariant result is
 * immutable append-only evidence.
 *
 * Phase 3G adds the additive `findings` table
 * (supabase/migrations/20260903000000_phase3g_findings.sql — NOT YET APPLIED
 * to the remote project; this type describes it in advance so the Phase 3G
 * repository can be written and unit-tested against a mocked client before
 * the migration is manually reviewed and applied, exactly as was done for the
 * Phase 3B `chaos_runs` table, the Phase 3E-A snapshot columns and the Phase
 * 3F-A `invariant_results` table). Unlike `invariant_results`, its `Update`
 * member is a real type: the migration DOES grant `service_role` UPDATE,
 * because a finding is a mutable lifecycle object by documented design
 * (docs/DATABASE.md Section 17). That is a DATABASE capability for Phase 4 —
 * Phase 3G production code performs no UPDATE on `findings` at all, which
 * `tests/unit/findings/phase3g-static-guard.test.ts` enforces at the source
 * level.
 *
 * Phase 4E adds the additive `regression_runs` table
 * (supabase/migrations/20260904000000_phase4e_regression_runs.sql — NOT YET
 * APPLIED to the remote project; this type describes it in advance so the
 * Phase 4E repository can be written and unit-tested against a mocked client
 * before the migration is manually reviewed and applied, exactly as was done
 * for `chaos_runs`, `invariant_results` and `findings`). Like `findings` and
 * unlike `invariant_results`, its `Update` member is a real type: the
 * migration grants `service_role` UPDATE because a regression run is a
 * lifecycle object (PENDING -> RUNNING -> RESOLVED/STILL_FAILING/ERROR). It
 * has deliberately no `updated_at` column — docs/DATABASE.md Section 18
 * defines seven columns and no such column.
 *
 * Do NOT add `reliability_score_snapshots` here — it is a P1-only table
 * (docs/DATABASE.md Section 19) created and typed by the phase that owns it,
 * if it is ever selected at all. `findings` is NOT one of them: docs/DATABASE.md Section 17
 * "Phase Ownership" and docs/PHASE_PLAN.md Section 3G both place its CREATE
 * in Phase 3, with Phase 4 only populating its diagnosis/recommendation
 * columns. `event_processing_attempts.source_kind` here is deliberately
 * scoped to exactly the two values the current CHECK constraint allows
 * (`REAL_RAZORPAY_WEBHOOK`, `PAYCHAOS_REPLAY`) — NOT the full four-value
 * approved-target vocabulary docs/DATABASE.md Section 14 documents.
 * `PAYCHAOS_SIMULATION`/`TEST_FIXTURE` remain unimplemented surface until
 * their own later phases; adding them to this type would misrepresent what
 * the database will currently accept.
 *
 * Phase 3E-A adds the additive `event_processing_attempts.state_before` /
 * `state_after` evidence-snapshot columns
 * (supabase/migrations/20260901000000_phase3e_evidence_snapshots.sql —
 * applied to the remote project during the Phase 3E-A real-verification
 * round; this type was written in advance of that so
 * `lib/evidence/evidence-repository.ts` could be unit-tested against a mocked
 * client first, exactly as was done for the Phase 3C `chaos_run_id` column).
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

/**
 * Phase 3F-A — `invariant_results` column vocabularies.
 *
 * These mirror the migration's CHECK constraints EXACTLY. They deliberately
 * duplicate, rather than import, `lib/invariants/types.ts`: this file
 * describes what the DATABASE will accept, and `lib/invariants/` describes
 * the evaluation domain. Keeping them separate means a future domain-level
 * widening cannot silently claim the database accepts a value its CHECK
 * still rejects. `tests/unit/invariants/types.test.ts` asserts the two stay
 * in agreement.
 *
 * `InvariantResultValue` is exactly PASS/FAIL/UNKNOWN. `NOT_APPLICABLE` and
 * `ERROR` are in-memory evaluation dispositions only and are deliberately
 * absent — there is no database representation for them.
 */
export type InvariantResultValue = "PASS" | "FAIL" | "UNKNOWN";

export type InvariantResultSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type InvariantResultInvariantId =
  | "INV-001"
  | "INV-002"
  | "INV-003"
  | "INV-004"
  | "INV-005"
  | "INV-006"
  | "INV-007"
  | "INV-008"
  | "INV-009"
  | "INV-010"
  | "INV-011"
  | "INV-012";

/**
 * Phase 3G — `findings` column vocabularies.
 *
 * These mirror the migration's CHECK constraints EXACTLY, and deliberately
 * live here rather than being imported from `lib/findings/types.ts`, for the
 * same reason the invariant vocabularies above do: this file describes what
 * the DATABASE will accept.
 *
 * `FindingDiagnosisStrength` is an evidence-STRENGTH label, never a
 * probabilistic confidence percentage (docs/DATABASE.md Section 17). Both
 * vocabularies are Phase 4 surface at the value level — Phase 3G writes only
 * `status: "OPEN"` and leaves `diagnosis_strength` NULL.
 */
export type FindingStatus = "OPEN" | "STILL_FAILING" | "RESOLVED";

/**
 * `regression_runs.status` (docs/DATABASE.md Section 18). `RESOLVED` and
 * `STILL_FAILING` are the two conclusive verdicts; `ERROR` means the
 * regression established neither proof — an inconclusive `UNKNOWN`
 * evaluation, a `BLOCKED` run, or a technical execution failure. `ERROR` is
 * never a claim that a payment failed.
 */
export type RegressionRunStatus =
  "PENDING" | "RUNNING" | "RESOLVED" | "STILL_FAILING" | "ERROR";

export type FindingDiagnosisStrength =
  "STRONG_EVIDENCE" | "PARTIAL_EVIDENCE" | "INSUFFICIENT_EVIDENCE";

/**
 * One `evidence_refs` array element: a REFERENCE to an existing record, never
 * a copy of the evidence. The database CHECK only enforces that
 * `evidence_refs` is a JSON array; this two-field shape is where the
 * per-element contract lives, deliberately rather than in hand-written
 * JSON-schema validation in SQL.
 */
export interface InvariantResultEvidenceRef {
  kind: string;
  id: string;
}

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
      invariant_results: {
        Row: {
          id: string;
          invariant_id: InvariantResultInvariantId;
          invariant_version: string;
          order_id: string | null;
          payment_attempt_id: string | null;
          payment_id: string | null;
          chaos_run_id: string | null;
          result: InvariantResultValue;
          severity: InvariantResultSeverity;
          expected_summary: string;
          observed_summary: string;
          reason: string;
          evidence_refs: InvariantResultEvidenceRef[];
          evaluated_at: string;
        };
        Insert: {
          id?: string;
          invariant_id: InvariantResultInvariantId;
          invariant_version?: string;
          order_id?: string | null;
          payment_attempt_id?: string | null;
          payment_id?: string | null;
          chaos_run_id?: string | null;
          result: InvariantResultValue;
          severity: InvariantResultSeverity;
          expected_summary: string;
          observed_summary: string;
          reason: string;
          evidence_refs?: InvariantResultEvidenceRef[];
          evaluated_at?: string;
        };
        // Deliberately `never`: the Phase 3F-A migration grants NO UPDATE
        // privilege on this table to ANY role, including service_role,
        // because a persisted invariant result is immutable append-only
        // evidence (docs/MONEY_INVARIANTS.md Section 49). A re-evaluation
        // INSERTs a new row. Typing this as `never` makes an attempted
        // `.update(...)` on `invariant_results` a compile-time error rather
        // than a runtime privilege error.
        Update: never;
        Relationships: [
          {
            foreignKeyName: "invariant_results_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invariant_results_payment_attempt_id_fkey";
            columns: ["payment_attempt_id"];
            isOneToOne: false;
            referencedRelation: "payment_attempts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invariant_results_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invariant_results_chaos_run_id_fkey";
            columns: ["chaos_run_id"];
            isOneToOne: false;
            referencedRelation: "chaos_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      findings: {
        Row: {
          id: string;
          invariant_result_id: string;
          status: FindingStatus;
          title: string;
          diagnosis_code: string | null;
          diagnosis_strength: FindingDiagnosisStrength | null;
          diagnosis_summary: string | null;
          recommendation_code: string | null;
          recommendation_text: string | null;
          diagnosed_at: string | null;
          resolved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        // Phase 3G supplies ONLY `invariant_result_id` and `title`; `status`
        // defaults to 'OPEN' and both timestamps default to now(). Every
        // diagnosis/recommendation/resolution field is optional here because
        // the DATABASE allows Phase 4 to set it — not because Phase 3G may.
        Insert: {
          id?: string;
          invariant_result_id: string;
          status?: FindingStatus;
          title: string;
          diagnosis_code?: string | null;
          diagnosis_strength?: FindingDiagnosisStrength | null;
          diagnosis_summary?: string | null;
          recommendation_code?: string | null;
          recommendation_text?: string | null;
          diagnosed_at?: string | null;
          resolved_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        // A real type, unlike `invariant_results["Update"]` which is `never`.
        // The Phase 3G migration grants `service_role` UPDATE because a
        // finding is a mutable lifecycle object (OPEN -> STILL_FAILING ->
        // RESOLVED, plus Phase 4 diagnosis/recommendation). `id` and
        // `invariant_result_id` are omitted deliberately: the identity of a
        // finding and the failed evaluation it reports are never re-pointed.
        Update: {
          status?: FindingStatus;
          title?: string;
          diagnosis_code?: string | null;
          diagnosis_strength?: FindingDiagnosisStrength | null;
          diagnosis_summary?: string | null;
          recommendation_code?: string | null;
          recommendation_text?: string | null;
          diagnosed_at?: string | null;
          resolved_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "findings_invariant_result_id_fkey";
            columns: ["invariant_result_id"];
            isOneToOne: true;
            referencedRelation: "invariant_results";
            referencedColumns: ["id"];
          },
        ];
      };
      regression_runs: {
        Row: {
          id: string;
          finding_id: string;
          chaos_run_id: string;
          status: RegressionRunStatus;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
        };
        // Phase 4E supplies ONLY `finding_id` and `chaos_run_id`; `status`
        // defaults to 'PENDING', `created_at` defaults to now(), and both
        // lifecycle timestamps default to NULL. No caller ever supplies a
        // creation timestamp.
        Insert: {
          id?: string;
          finding_id: string;
          chaos_run_id: string;
          status?: RegressionRunStatus;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        // A real type, like `findings["Update"]` and unlike
        // `invariant_results["Update"]` which is `never`: the migration
        // grants `service_role` UPDATE because a regression run is a
        // lifecycle object. `id`, `finding_id` and `chaos_run_id` are
        // omitted deliberately — a regression is never re-pointed at a
        // different finding or a different chaos run. There is no
        // `updated_at` on this table.
        Update: {
          status?: RegressionRunStatus;
          started_at?: string | null;
          completed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "regression_runs_finding_id_fkey";
            columns: ["finding_id"];
            isOneToOne: false;
            referencedRelation: "findings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "regression_runs_chaos_run_id_fkey";
            columns: ["chaos_run_id"];
            isOneToOne: true;
            referencedRelation: "chaos_runs";
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
      /**
       * Phase 5 — the atomic Demo Reset.
       *
       * `Args: Record<string, never>` is load-bearing, not cosmetic: it makes
       * it a TYPE ERROR to pass this function anything at all, which is the
       * same guarantee the SQL side gives by taking no parameters. A reset
       * that could accept an argument would be a step towards a generic
       * delete surface.
       */
      reset_paychaos_demo_runtime: {
        Args: Record<string, never>;
        Returns: Record<string, number>;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
