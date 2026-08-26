-- PayChaos AI — Phase 3B additive migration.
--
-- Creates `public.chaos_runs` (docs/DATABASE.md Section 15) — the durable
-- audit record of one requested execution of one predefined P0 chaos
-- scenario. This is the FIRST Phase 3 table. It does not itself execute
-- anything: no replay, no fault injection, no Razorpay call, no
-- payment/order/fulfilment mutation is performed by this migration or by
-- the Phase 3B repository/service code that writes to this table.
--
-- This migration does NOT edit, rewrite, or squash any approved Phase 1/2
-- migration — it is purely additive, per docs/DATABASE.md Section 44
-- "Migration Ownership by Phase".
--
-- This migration does NOT:
--   - add `chaos_run_id` to `event_processing_attempts`;
--   - widen `event_processing_attempts.source_kind`'s CHECK constraint to
--     allow PAYCHAOS_REPLAY/PAYCHAOS_SIMULATION/TEST_FIXTURE;
--   - create `invariant_results`, `findings`, or `regression_runs`.
-- Those all remain Phase 3C+ work — Phase 3B creates zero
-- `event_processing_attempts` rows itself, so widening that CHECK now would
-- be unused, untested surface (the same reasoning the Phase 2E migration
-- already applied to this exact deferral).
--
-- NULLABILITY (architect-approved correction to the originally-planned
-- schema — the frozen Phase 3A registry made a stricter NOT NULL shape
-- impossible to satisfy for real P0 scenarios):
--   - `order_id`/`payment_attempt_id`/`payment_id`/`source_webhook_event_id`
--     are all nullable. C03 (Mechanism C, PayChaos's own fixed internal
--     webhook-verification path) has no merchant order/payment/webhook
--     target at all — a NOT NULL order_id would force fabricating a link to
--     an order the scenario never touches. C07 and C11 Mechanism A begin
--     from a fresh order, but Phase 3A's own precheck contract
--     (`docs/CHAOS_SCENARIOS.md` Section 19/23) never guarantees that order
--     already has a `payment_attempts` row — Checkout, which creates the
--     attempt, happens AFTER a chaos run is requested, not before. FKs
--     still apply whenever a value is non-null.
--   - `fault_type` is nullable. C11's frozen registry entry
--     (`lib/chaos/registry.ts`) has `allowedFaultTypes: []` — neither of its
--     two mechanisms ever has a fault primitive to record. There is no
--     fourth "no fault" primitive; this column is simply NULL for C11.
--
-- `failed_precheck_id` is a new column (architect-approved) recording which
-- of Phase 3A's ten official PRECHECK-xx IDs blocked a run, for exactly the
-- BLOCKED cases Phase 3B is authorized to persist (docs/DATABASE.md Section
-- 15, this migration's own CHECK constraints below). It is never populated
-- for a PENDING row.
--
-- `chaos_runs_blocked_state_consistent` and `chaos_runs_pending_state_consistent`
-- encode the two lifecycle shapes Phase 3B itself ever produces directly in
-- the database, rather than trusting application code alone (this
-- project's existing principle — docs/ARCHITECTURE.md Section 25:
-- "Application-level `if` statements must not be the only protection
-- against duplicate writes where PostgreSQL can enforce the invariant").
-- Deliberately does NOT constrain future RUNNING/COMPLETED[PASS/FAIL/
-- UNKNOWN/ERROR]/FAILED-status semantics — those belong to Phase 3C/3D, not
-- yet implemented.
--
-- This migration contains no secrets. It only defines schema, constraints,
-- indexes, RLS and narrow privilege grants.
--
-- NOT APPLIED YET: this file is prepared for later manual/developer-driven
-- application against the real Supabase project, using the same protocol
-- already used for the Phase 1, Phase 2B, Phase 2C, Phase 2D, Phase 2E, and
-- Phase 2F migrations, and only after architect review of this Phase 3B
-- candidate.

-- ============================================================================
-- TABLE: chaos_runs  (docs/DATABASE.md Section 15)
-- ============================================================================

create table public.chaos_runs (
  id uuid primary key default gen_random_uuid(),

  scenario_id text not null,

  order_id uuid references public.orders (id) on delete restrict,
  payment_attempt_id uuid references public.payment_attempts (id) on delete restrict,
  payment_id uuid references public.payments (id) on delete restrict,
  source_webhook_event_id uuid references public.webhook_events (id) on delete restrict,

  status text not null default 'PENDING',
  outcome text,

  fault_type text,
  failed_precheck_id text,

  fault_config jsonb not null default '{}',
  fault_state jsonb not null default '{}',

  data_classification text not null,

  error_message_redacted text,

  started_at timestamptz,
  completed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint chaos_runs_scenario_id_valid check (
    scenario_id in ('C01', 'C03', 'C07', 'C11')
  ),
  constraint chaos_runs_status_valid check (
    status in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')
  ),
  constraint chaos_runs_outcome_valid check (
    outcome is null or outcome in ('PASS', 'FAIL', 'UNKNOWN', 'BLOCKED', 'ERROR')
  ),
  constraint chaos_runs_fault_type_valid check (
    fault_type is null or fault_type in (
      'REPLAY_EVENT', 'INVALID_SIGNATURE_TEST', 'DROP_CLIENT_CONFIRMATION'
    )
  ),
  constraint chaos_runs_failed_precheck_id_valid check (
    failed_precheck_id is null or failed_precheck_id in (
      'PRECHECK-01', 'PRECHECK-02', 'PRECHECK-03', 'PRECHECK-04',
      'PRECHECK-05', 'PRECHECK-06', 'PRECHECK-07', 'PRECHECK-08',
      'PRECHECK-09', 'PRECHECK-10'
    )
  ),
  constraint chaos_runs_data_classification_valid check (
    data_classification in ('RECORDED_TEST_EVIDENCE', 'SYNTHETIC_DEMO')
  ),
  constraint chaos_runs_fault_config_is_object check (
    jsonb_typeof(fault_config) = 'object'
  ),
  constraint chaos_runs_fault_state_is_object check (
    jsonb_typeof(fault_state) = 'object'
  ),
  constraint chaos_runs_blocked_state_consistent check (
    (
      outcome = 'BLOCKED'
      and status = 'COMPLETED'
      and failed_precheck_id is not null
      and error_message_redacted is not null
      and started_at is null
      and completed_at is not null
    )
    or (
      outcome is distinct from 'BLOCKED'
      and failed_precheck_id is null
    )
  ),
  constraint chaos_runs_pending_state_consistent check (
    status <> 'PENDING'
    or (
      outcome is null
      and failed_precheck_id is null
      and started_at is null
      and completed_at is null
    )
  )
);

comment on table public.chaos_runs is
  'Phase 3B — one durable audit record per requested execution of one P0 '
  'chaos scenario (C01/C03/C07/C11). Phase 3B creates only two shapes: a '
  'PENDING row (Phase 3A precheck passed; no execution yet) and a '
  'COMPLETED/BLOCKED row (a persistable precheck failure — see '
  'chaos_runs_blocked_state_consistent). RUNNING and any '
  'COMPLETED/PASS|FAIL|UNKNOWN|ERROR or FAILED-status row belong to a later '
  'phase that actually executes a mechanism. This table is the audit path '
  'satisfying PRE-SEC-011 (docs/SECURITY.md) — a run must never be treated '
  'as executable unless its record already exists here.';

comment on column public.chaos_runs.order_id is
  'Nullable: C03 (Mechanism C) has no merchant order target at all. When '
  'present for another scenario, it refers to a genuinely resolved/'
  'validated order — never a fabricated link created merely to satisfy '
  'this column.';

comment on column public.chaos_runs.payment_attempt_id is
  'Nullable: a fresh order (C07, C11 Mechanism A) is not guaranteed to '
  'already have a payment_attempts row at chaos-run creation time — '
  'Checkout, which creates the attempt, happens after the run is '
  'requested. Never fabricated to satisfy this column.';

comment on column public.chaos_runs.fault_type is
  'Nullable: C11 has no unsafe fault primitive of its own '
  '(lib/chaos/registry.ts allowedFaultTypes: []) — this is NULL for both '
  'of its mechanisms, never a fabricated fourth "no fault" primitive.';

comment on column public.chaos_runs.failed_precheck_id is
  'Which of Phase 3A''s ten official PRECHECK-xx IDs blocked this run. '
  'Populated only for a persistable BLOCKED outcome (PRECHECK-07/08/09/10 '
  'against a registered scenario) — never for PRECHECK-01/02/03/05/06, '
  'which Phase 3B does not persist at all (docs/DATABASE.md Section 15).';

comment on column public.chaos_runs.error_message_redacted is
  'A safe, deterministic explanation only (the stable Phase 3A reason '
  'string) — never a raw database error, secret, or raw request content.';

comment on column public.chaos_runs.fault_config is
  'Server-built sanitized configuration snapshot only — never a copy of a '
  'caller-supplied raw request object. Always {} for a BLOCKED row.';

comment on column public.chaos_runs.fault_state is
  'Runtime hold/release/transient state, owned by later execution phases. '
  'Always {} for anything Phase 3B itself creates.';

comment on column public.chaos_runs.data_classification is
  'NOT NULL with deliberately NO DEFAULT (architect correction) — '
  'RECORDED_TEST_EVIDENCE is authoritative genuine-evidence provenance '
  'metadata, so a server-side bug or future writer must never be able to '
  'omit this column and silently receive the strongest classification by '
  'default. Every writer (lib/chaos/run-repository.ts) must supply this '
  'value explicitly; an INSERT that omits it fails closed at the database '
  'level rather than silently defaulting in either direction. Never '
  'caller/browser controlled — always server-derived.';

-- Required indexes — docs/DATABASE.md Section 15 "Indexes".
create index chaos_runs_scenario_id_idx on public.chaos_runs (scenario_id);
create index chaos_runs_order_id_idx on public.chaos_runs (order_id);
create index chaos_runs_payment_attempt_id_idx on public.chaos_runs (payment_attempt_id);
create index chaos_runs_payment_id_idx on public.chaos_runs (payment_id);
create index chaos_runs_source_webhook_event_id_idx on public.chaos_runs (source_webhook_event_id);
create index chaos_runs_status_created_at_idx on public.chaos_runs (status, created_at);
create index chaos_runs_data_classification_completed_at_idx on public.chaos_runs (data_classification, completed_at);

-- ============================================================================
-- ROW LEVEL SECURITY AND PRIVILEGES  (docs/DATABASE.md Section 40,
-- docs/SECURITY.md Section 25)
--
-- Same explicit, source-controlled access model already used by every prior
-- P0 migration: RLS enabled with zero policies (denies all access to
-- anon/authenticated by default), privileges additionally REVOKEd
-- explicitly rather than relying on the absence of a GRANT alone, and
-- narrow explicit CRUD GRANTs to `service_role` only (the trusted Next.js
-- server credential). No browser/anon/authenticated code may ever write an
-- authoritative chaos_runs row.
-- ============================================================================

alter table public.chaos_runs enable row level security;

revoke all privileges on table public.chaos_runs from anon, authenticated;

grant select, insert, update, delete on public.chaos_runs to service_role;
