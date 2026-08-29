-- PayChaos AI — Phase 3F-A additive migration.
--
-- Creates `public.invariant_results` (docs/DATABASE.md Section 16) — the
-- immutable, append-only authoritative record of one deterministic Money
-- Invariant evaluation. This is the FIRST invariant table and the ONLY
-- migration Phase 3F introduces.
--
-- This migration is SCHEMA ONLY. It does not evaluate an invariant, does
-- not assign PASS/FAIL/UNKNOWN to anything, creates no evaluator, no
-- function, no trigger, no view, and writes zero rows. Phase 3F-A
-- deliberately ships no evaluator at all: the deterministic INV-001…INV-012
-- rules are Phase 3F-B, and evaluation orchestration/persistence is Phase
-- 3F-C.
--
-- This migration does NOT:
--   - create `findings`, `regression_runs`, or `reliability_score_snapshots`
--     (Phase 4 tables, not authorized here);
--   - alter ANY existing table — no ALTER TABLE statement appears below;
--   - touch `chaos_runs`, `event_processing_attempts`, `webhook_events`,
--     `orders`, `payment_attempts`, `payments`, `fulfilments`, or either
--     existing RPC;
--   - modify, backfill, or reinterpret any historical evidence row.
-- It is purely additive, per docs/DATABASE.md Section 44 "Migration
-- Ownership by Phase".
--
-- ARCHITECT NULLABILITY CORRECTION (binding, Phase 3F-A).
-- docs/DATABASE.md Section 16's original planning table declared
-- `order_id` and `payment_attempt_id` as NOT NULL. That is wrong for a real
-- C03 evaluation and is corrected here, exactly as the identical correction
-- was already applied to `chaos_runs` in Phase 3B:
--
--   C03 (Mechanism C) targets PayChaos's own fixed internal
--   webhook-verification path. It has NO merchant order, NO payment
--   attempt and NO payment — `lib/chaos/c03-execution-service.ts` performs
--   two HMAC checks against a fixed internal verifier and touches no
--   merchant entity whatsoever. Its already-approved chaos runs carry all
--   four correlation FKs as NULL. A NOT NULL `order_id` here would force an
--   INV-005 result to fabricate a link to an order the scenario never
--   touched, which docs/MONEY_INVARIANTS.md Section 12 and CLAUDE.md
--   Section 12 both forbid: a NULL link is preferred over a false one.
--
-- C03's evaluation is anchored to `chaos_run_id` plus the factual synthetic
-- mutation evidence persisted on that run. All four correlation columns are
-- therefore NULLABLE; the FK still applies whenever a value is non-null.
--
-- Nullable individually is NOT the same as "all four may be NULL together".
-- `invariant_results_subject_present` (below) requires at least one anchor,
-- so a C03 result must still carry its `chaos_run_id` and a baseline result
-- must still carry a real order/payment-attempt/payment subject. Every
-- authoritative money verdict remains traceable to something durable.
--
-- RESULT VOCABULARY. `result` accepts EXACTLY PASS/FAIL/UNKNOWN.
-- NOT_APPLICABLE and ERROR are in-memory Phase 3F evaluation dispositions
-- (docs/MONEY_INVARIANTS.md Sections 32/36/37/38) and have deliberately NO
-- schema representation — the database refuses to store them, so a future
-- application bug cannot silently persist "the rule did not apply" or "the
-- evaluator crashed" as though it were authoritative payment truth.
--
-- APPEND-ONLY. A persisted invariant result is immutable historical
-- evaluation evidence (docs/MONEY_INVARIANTS.md Section 49). A re-test
-- creates a NEW row; a FAIL is never rewritten to PASS. This migration
-- grants NO UPDATE privilege to any role at all (see the privilege block
-- at the end), which is a genuine narrowing versus every previous table in
-- this project. DELETE is retained for `service_role` because
-- docs/DATABASE.md Section 39 "Reset Scope"/"Reset Order" lists
-- `invariant_results` as step 3 of the intentional administrative Demo
-- Reset.
--
-- This migration contains no secrets. It only defines schema, constraints,
-- indexes, RLS and narrow privilege grants.
--
-- NOT APPLIED YET: this file is prepared for later manual/developer-driven
-- application against the real Supabase project, using the same protocol
-- already used for every Phase 1/2/3 migration, and only after architect
-- review of this Phase 3F-A candidate.

-- ============================================================================
-- TABLE: invariant_results  (docs/DATABASE.md Section 16)
-- ============================================================================

create table public.invariant_results (
  id uuid primary key default gen_random_uuid(),

  invariant_id text not null,
  invariant_version text not null default '1',

  order_id uuid references public.orders (id) on delete restrict,
  payment_attempt_id uuid references public.payment_attempts (id) on delete restrict,
  payment_id uuid references public.payments (id) on delete restrict,
  chaos_run_id uuid references public.chaos_runs (id) on delete restrict,

  result text not null,
  severity text not null,

  expected_summary text not null,
  observed_summary text not null,
  reason text not null,

  evidence_refs jsonb not null default '[]',

  evaluated_at timestamptz not null default now(),

  constraint invariant_results_invariant_id_valid check (
    invariant_id in (
      'INV-001', 'INV-002', 'INV-003', 'INV-004',
      'INV-005', 'INV-006', 'INV-007', 'INV-008',
      'INV-009', 'INV-010', 'INV-011', 'INV-012'
    )
  ),
  constraint invariant_results_result_valid check (
    result in ('PASS', 'FAIL', 'UNKNOWN')
  ),
  constraint invariant_results_severity_valid check (
    severity in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
  ),
  constraint invariant_results_evidence_refs_is_array check (
    jsonb_typeof(evidence_refs) = 'array'
  ),
  -- SUBJECT ANCHOR (architect blocker 3F-A-01). Each of the four
  -- correlations is individually nullable — deliberately none of them is
  -- NOT NULL — but an authoritative money result must always have at least
  -- ONE durable subject to be traceable to. A row with all four NULL would
  -- be an orphan verdict about nothing, and no legitimate evaluation
  -- produces one:
  --   C03            -> chaos_run_id NON-NULL, the other three NULL.
  --   baseline order -> order_id (or payment_attempt_id / payment_id)
  --                     NON-NULL, chaos_run_id NULL.
  -- `chaos_run_id` is nullable ONLY so baseline evaluation is supported; a
  -- baseline evaluation still has a real merchant/payment subject.
  constraint invariant_results_subject_present check (
    order_id is not null
    or payment_attempt_id is not null
    or payment_id is not null
    or chaos_run_id is not null
  )
);

comment on table public.invariant_results is
  'Phase 3F-A — immutable, append-only authoritative results of the '
  'deterministic Money Invariant Engine (docs/MONEY_INVARIANTS.md). One '
  'row is one evaluation of one invariant. AI/LLM output never writes, '
  'modifies or overrides a row here: this table is deterministic payment '
  'truth and AI is advisory only (CLAUDE.md Section 11). A re-evaluation '
  'appends a NEW row — a persisted result is never updated, and a FAIL is '
  'never rewritten to PASS (docs/MONEY_INVARIANTS.md Section 49). Phase '
  '3F-A creates this schema only; no evaluator exists yet.';

comment on column public.invariant_results.invariant_id is
  'One of the twelve frozen P0 catalogue IDs INV-001..INV-012 '
  '(docs/MONEY_INVARIANTS.md Section 14). Constrained in the database '
  'rather than by application code alone so an unknown or P1 invariant ID '
  '(e.g. INV-013/INV-014) can never be persisted as a P0 result. '
  'lib/invariants/registry.ts owns the same twelve IDs in TypeScript.';

comment on column public.invariant_results.invariant_version is
  'Version of the deterministic rule that produced this result. P0 begins '
  'at ''1'' for every frozen invariant (docs/MONEY_INVARIANTS.md Section '
  '48). If an invariant''s deterministic meaning changes later, its '
  'version increments so historical results stay distinguishable — an '
  'evaluator must never be changed silently.';

comment on column public.invariant_results.order_id is
  'Nullable (architect correction to the original Section 16 planning '
  'table, which declared this NOT NULL). C03 has no merchant order at all, '
  'so an INV-005 result for a C03 chaos run has no order to reference. A '
  'NULL link is required here precisely so no result ever fabricates a '
  'correlation to an entity the evaluation never examined.';

comment on column public.invariant_results.payment_attempt_id is
  'Nullable, for the same reason as order_id — C03 has no payment attempt. '
  'Never fabricated to satisfy this column.';

comment on column public.invariant_results.payment_id is
  'Nullable: many invariants evaluate order/attempt-level facts, and C03 '
  'has no payment at all.';

comment on column public.invariant_results.chaos_run_id is
  'Nullable ONLY because baseline (non-chaos) evaluation is supported — a '
  'NULL here means a baseline evaluation, which still requires a real '
  'order/payment-attempt/payment subject via '
  'invariant_results_subject_present. For C03 this is the ONLY correlation '
  'a result can truthfully carry, and it is REQUIRED there: C03''s '
  'evaluation is anchored to this run plus the factual mutation evidence '
  'persisted on chaos_runs.fault_state. A C03 result with chaos_run_id '
  'NULL would have no subject at all and is rejected.';

comment on column public.invariant_results.result is
  'EXACTLY PASS, FAIL or UNKNOWN. NOT_APPLICABLE and ERROR are in-memory '
  'evaluation dispositions only (docs/MONEY_INVARIANTS.md Sections '
  '32/36/37/38) and are deliberately NOT representable here — the '
  'database fails closed rather than letting "rule did not apply" or '
  '"evaluator crashed" be stored as authoritative payment truth. UNKNOWN '
  'IS authoritative: it means the rule applied but the evidence was '
  'insufficient, and it must never be read as PASS.';

comment on column public.invariant_results.severity is
  'Severity SNAPSHOT taken at evaluation time, so a historical result '
  'stays explainable even if the catalogue''s default severity changes '
  'later. LOW/MEDIUM/HIGH/CRITICAL only — deliberately no INFO/WARNING.';

comment on column public.invariant_results.expected_summary is
  'The deterministic expected condition, in the evaluator''s own words. '
  'FACT/EVIDENCE only — never AI-generated text, diagnosis, root cause or '
  'a recommendation (CLAUDE.md Section 12).';

comment on column public.invariant_results.observed_summary is
  'The observed condition, derived only from verified persisted state. '
  'Never AI-generated, never frontend-supplied.';

comment on column public.invariant_results.reason is
  'Deterministic evaluator explanation. Must contain no secret, no raw '
  'webhook payload, no signature, no customer PII, and no AI output.';

comment on column public.invariant_results.evidence_refs is
  'JSON ARRAY of {kind, id} references to records that already exist — '
  'never a copy of the evidence itself. There is no generic evidence '
  'table (docs/MONEY_INVARIANTS.md Section 42). A raw webhook payload, '
  'normalized_event, signature, secret, customer PII, diagnosis text, '
  'recommendation text or any AI output must NEVER be written here. The '
  'CHECK enforces only that this is a JSON array — the per-element shape '
  'is owned and enforced by lib/invariants/types.ts, deliberately not by '
  'hand-written JSON-schema validation in SQL.';

-- Required indexes — docs/DATABASE.md Sections 16 "Indexes" and 42.
--
-- The partial UNIQUE index is the append-only protection: for one chaos
-- run, one invariant is evaluated at most once, enforced by PostgreSQL
-- rather than by an application `if` (docs/ARCHITECTURE.md Section 25).
-- It is deliberately PARTIAL: baseline evaluations (chaos_run_id IS NULL)
-- may legitimately recur over time and must not be blocked. Uniqueness is
-- NOT placed on invariant_id alone — different chaos runs are different
-- historical evaluations of the same rule and must all be retained.
create unique index invariant_results_chaos_run_invariant_uniq
  on public.invariant_results (chaos_run_id, invariant_id)
  where chaos_run_id is not null;

create index invariant_results_payment_attempt_id_idx on public.invariant_results (payment_attempt_id);
create index invariant_results_payment_id_idx on public.invariant_results (payment_id);
create index invariant_results_result_idx on public.invariant_results (result);
create index invariant_results_severity_idx on public.invariant_results (severity);
create index invariant_results_evaluated_at_idx on public.invariant_results (evaluated_at);

-- ============================================================================
-- ROW LEVEL SECURITY AND PRIVILEGES  (docs/DATABASE.md Sections 40/41,
-- docs/SECURITY.md Section 25)
--
-- Same explicit, source-controlled access model as every prior P0
-- migration: RLS enabled with ZERO policies (which denies all access to
-- anon/authenticated), privileges additionally REVOKEd explicitly rather
-- than relying on the absence of a GRANT alone, and narrow explicit GRANTs
-- to `service_role` only.
--
-- DELIBERATE NARROWING versus every earlier table in this project: NO
-- UPDATE privilege is granted to ANY role, including service_role. An
-- invariant result is immutable during normal application operation
-- (docs/MONEY_INVARIANTS.md Section 49), so the append-only guarantee is
-- enforced by privilege, not merely by convention in repository code — a
-- future service-layer bug attempting to rewrite a FAIL into a PASS fails
-- at the database.
--
-- DELETE IS retained for service_role because docs/DATABASE.md Section 39
-- lists `invariant_results` as step 3 of the intentional administrative
-- Demo Reset. That is a controlled, explicitly-documented operation, not
-- normal application behavior.
-- ============================================================================

alter table public.invariant_results enable row level security;

revoke all privileges on table public.invariant_results from anon, authenticated;

grant select, insert, delete on public.invariant_results to service_role;
