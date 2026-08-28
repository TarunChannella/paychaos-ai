-- PayChaos AI — Phase 3E-A additive migration: deterministic evidence
-- snapshot columns on `event_processing_attempts` ONLY.
--
-- This migration does NOT execute anything and creates NO new table. It adds
-- exactly two nullable JSONB columns plus their two shape CHECK constraints.
-- It does not add `fault_action`, does not widen
-- `event_processing_attempts_source_kind_valid` (so `PAYCHAOS_SIMULATION`
-- and `TEST_FIXTURE` remain unaccepted, and TEST_FIXTURE runtime processing
-- stays impossible), does not touch `chaos_runs`, does not create
-- `invariant_results`/`findings`/`regression_runs`, and introduces no
-- invariant/PASS/FAIL/finding schema of any kind. Those all belong to Phase
-- 3E-B / 3F / 3G, none of which are approved yet.
--
-- Purely additive: it does not edit, rewrite, or squash
-- 20260827000000_phase2e_webhook_dedup.sql,
-- 20260828000000_phase2f_merchant_processing.sql,
-- 20260830000000_phase3c_controlled_replay.sql or
-- 20260831000000_phase3d_execution_safety.sql — all remain byte-for-byte
-- unchanged on disk. It performs no DROP TABLE and no DROP COLUMN.
--
-- ============================================================================
-- A. Why these two columns exist (docs/DATABASE.md Section 14 "Evidence
--    Snapshot Rule"; docs/MONEY_INVARIANTS.md Section 43)
-- ============================================================================
--
-- `orders`, `payment_attempts`, `payments` and `fulfilments` are MUTABLE.
-- A later payment, a later chaos run, or an ordinary retry can move an order
-- from UNPAID to PAID long after some earlier processing attempt happened.
-- Historical chaos evidence must therefore never be reconstructed from
-- "whatever the current order row happens to contain right now".
--
-- `state_before` / `state_after` record the correlated merchant state
-- observed immediately around ONE processing attempt's own run through the
-- internal Event Processor, so a later deterministic invariant evaluation
-- (Phase 3F) reads immutable historical facts instead of re-deriving the
-- past. They are deliberately kept ON the processing attempt rather than in
-- a separate generic evidence table: docs/DATABASE.md Section 31 ("There is
-- no generic evidence table") and Section 5 ("Separate `evidence` Table —
-- NOT REQUIRED") are explicit, and later `invariant_results.evidence_refs`
-- references existing record identities rather than copying payloads.
--
-- ============================================================================
-- B. Nullability — deliberate, and never to be tightened later
-- ============================================================================
--
-- Both columns are NULLABLE with NO DEFAULT. A NULL snapshot is a valid,
-- truthful state meaning "this evidence was not durably captured". It is
-- never an error state to be papered over, and application code must never
-- fabricate a snapshot to avoid a NULL:
--
--   * snapshot capture is instrumentation AROUND the frozen Phase 2F/3C
--     `process_webhook_payment_event` transaction — it never participates in
--     that transaction, never changes money/business semantics, and a
--     capture failure must leave the column NULL rather than invent state;
--   * every historical row that already exists when this migration is
--     applied keeps NULL for both columns — this migration deliberately
--     performs no backfill, because a snapshot taken today would be a false
--     claim about a processing attempt that ran in the past;
--   * docs/DATABASE.md Principle 8 / docs/MONEY_INVARIANTS.md: missing
--     required evidence is exactly what later allows an invariant evaluator
--     to return UNKNOWN. UNKNOWN is a valid result; a fabricated PASS is
--     not. Making these columns NOT NULL would destroy that distinction.
--
-- ============================================================================
-- C. Set-once semantics live in the application's conditional UPDATE
-- ============================================================================
--
-- docs/DATABASE.md Principle 7 ("Historical Results Are Not Rewritten"):
-- these snapshots are write-once evidence. That is enforced by the
-- application through a single atomic conditional update
-- (`UPDATE ... WHERE id = $1 AND state_before IS NULL`, see
-- lib/evidence/evidence-repository.ts), the same idiom this codebase already
-- uses for every other guarded chaos-run write. It is intentionally NOT
-- expressed as a database trigger: this project's approved architecture puts
-- exactly one narrow SECURITY INVOKER function (`process_webhook_payment_event`)
-- in the database and keeps everything else as plain tables plus explicit
-- constraints. A trigger here would add a second piece of hidden server-side
-- behavior for no correctness gain the conditional UPDATE does not already
-- provide.
alter table public.event_processing_attempts
  add column state_before jsonb;

comment on column public.event_processing_attempts.state_before is
  'Phase 3E-A — deterministic snapshot of the correlated merchant state '
  '(order / payment attempt / payment / fulfilments) observed immediately '
  'BEFORE this processing attempt ran through the internal Event Processor. '
  'A versioned JSON object built by lib/evidence/merchant-state-snapshot.ts '
  'from an explicit allowlist projection of persisted server-side columns '
  'only: internal ids, states, integer amount_subunits, currency, provider '
  'status, and persisted timestamps. It never contains a raw Razorpay '
  'webhook body, a signature, any secret, or any customer PII. NULL means '
  'the snapshot was not durably captured — never that the state was empty; '
  'a later invariant evaluation treats missing required evidence as UNKNOWN '
  'rather than PASS. Written at most once (set-once conditional UPDATE); a '
  'retry never rewrites historical evidence.';

alter table public.event_processing_attempts
  add column state_after jsonb;

comment on column public.event_processing_attempts.state_after is
  'Phase 3E-A — the same deterministic snapshot shape as state_before, '
  'observed immediately AFTER this processing attempt ran through the '
  'internal Event Processor (attempted for both successful and failed '
  'processing, since a failed attempt''s resulting state is itself evidence '
  'for later INV-009 evaluation). NULL means the post-state read or its '
  'persistence did not succeed — the application never fabricates a '
  'state_after to make the evidence look complete. Written at most once '
  '(set-once conditional UPDATE).';

-- ============================================================================
-- D. Shape constraints — object or NULL, never a scalar or array
-- ============================================================================
--
-- Mirrors the existing `chaos_runs_fault_config_is_object` /
-- `chaos_runs_fault_state_is_object` pattern. A snapshot is always a JSON
-- OBJECT (the versioned MerchantStateSnapshotV1 envelope) or NULL. A bare
-- number/string/boolean/array is never valid evidence here, and the database
-- — not application discipline alone — rejects it.
alter table public.event_processing_attempts
  add constraint event_processing_attempts_state_before_is_object check (
    state_before is null or jsonb_typeof(state_before) = 'object'
  );

alter table public.event_processing_attempts
  add constraint event_processing_attempts_state_after_is_object check (
    state_after is null or jsonb_typeof(state_after) = 'object'
  );
