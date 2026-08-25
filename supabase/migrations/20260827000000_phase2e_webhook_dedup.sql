-- PayChaos AI — Phase 2E additive migration.
--
-- Adds the durable boundary between EVENT IDENTITY (`webhook_events`,
-- Phase 2D) and PROCESSING ATTEMPT identity (`event_processing_attempts`,
-- this migration) — docs/ARCHITECTURE.md ADR-A09, docs/DATABASE.md
-- Section 14. Also adds a narrowly-scoped atomic RPC for the
-- `duplicate_delivery_count` increment, since a JavaScript
-- read-then-increment-then-write would lose increments under concurrent
-- duplicate deliveries.
--
-- This migration does NOT edit, rewrite, or squash the approved Phase 1,
-- Phase 2B, Phase 2C, or Phase 2D migrations — it is purely additive, per
-- docs/DATABASE.md Section 44 "Migration Ownership by Phase".
--
-- This migration does NOT create `chaos_runs`, `invariant_results`,
-- `findings`, or `regression_runs` — those remain later-phase work. It
-- also deliberately does NOT add the Phase 3-only
-- `event_processing_attempts` columns (`chaos_run_id`, `fault_action`,
-- `state_before`, `state_after`) — docs/DATABASE.md Section 14 "Phase
-- Ownership" pre-approves those as a later additive migration, not this
-- one. `source_kind` is CHECK-fixed to exactly `REAL_RAZORPAY_WEBHOOK` for
-- this same reason — the other three provenance values
-- (`PAYCHAOS_REPLAY`/`PAYCHAOS_SIMULATION`/`TEST_FIXTURE`) are real,
-- pre-approved values in docs/DATABASE.md Section 14, but are not needed
-- until the Phase 3 chaos/replay work that produces them exists; adding
-- them now would be unused, untested surface.
--
-- This migration contains no secrets. It only defines schema, constraints,
-- indexes, a narrowly-scoped SQL function, RLS and narrow privilege
-- grants.
--
-- NOT APPLIED YET: this file is prepared for later manual/developer-driven
-- application against the real Supabase project, using the same protocol
-- already used for the Phase 1, Phase 2B, Phase 2C, and Phase 2D
-- migrations, and only after architect review of this Phase 2E candidate.

-- ============================================================================
-- FUNCTION: record_webhook_duplicate_delivery  (docs/DATABASE.md Section 13
-- "Duplicate Delivery Rules")
--
-- Atomically increments `webhook_events.duplicate_delivery_count` for one
-- `razorpay_event_id` and returns the updated canonical row. A single
-- `UPDATE ... SET count = count + 1 ... RETURNING *` is safe under
-- concurrent callers because Postgres serializes concurrent UPDATEs to the
-- same row via its normal row-level locking — this is NOT a
-- SELECT-then-increment-in-application-code-then-UPDATE pattern, which
-- would lose increments under a genuine race (two duplicate deliveries
-- arriving concurrently).
--
-- `language sql` with a single parameterized statement — no dynamic SQL,
-- no arbitrary table name input, no string concatenation. `security
-- invoker` (not `security definer`): the only caller is the trusted
-- Next.js server credential (`service_role`), which already holds the
-- required `UPDATE` privilege on `webhook_events` from the Phase 2D
-- migration, so no privilege elevation is needed and no `search_path`
-- hijacking surface exists for a definer context. `search_path` is still
-- pinned explicitly as defense-in-depth.
-- ============================================================================

create function public.record_webhook_duplicate_delivery(
  p_razorpay_event_id text
)
returns public.webhook_events
language sql
security invoker
set search_path = public
as $$
  update public.webhook_events
  set
    duplicate_delivery_count = duplicate_delivery_count + 1,
    updated_at = now()
  where razorpay_event_id = p_razorpay_event_id
  returning *;
$$;

comment on function public.record_webhook_duplicate_delivery(text) is
  'Phase 2E — atomically increments webhook_events.duplicate_delivery_count '
  'for one razorpay_event_id and returns the updated canonical row. The '
  'only correct way to record a genuine duplicate delivery; never '
  'implement this as a SELECT-then-increment-in-application-code pattern, '
  'which would lose increments under a real concurrent-duplicate race.';

-- Postgres grants EXECUTE on newly created functions to PUBLIC by default
-- — explicitly revoke that, then grant only to service_role. Neither anon
-- nor authenticated may ever call this function.
revoke all on function public.record_webhook_duplicate_delivery(text) from public;
grant execute on function public.record_webhook_duplicate_delivery(text) to service_role;

-- ============================================================================
-- TABLE: event_processing_attempts  (docs/DATABASE.md Section 14)
-- ============================================================================

create table public.event_processing_attempts (
  id uuid primary key default gen_random_uuid(),

  webhook_event_id uuid references public.webhook_events (id) on delete restrict,
  payment_attempt_id uuid references public.payment_attempts (id) on delete restrict,
  payment_id uuid references public.payments (id) on delete restrict,

  source_kind text not null default 'REAL_RAZORPAY_WEBHOOK',
  is_duplicate_delivery boolean not null default false,
  status text not null default 'PENDING',

  normalized_event jsonb not null default '{}',

  error_code text,
  error_message_redacted text,

  started_at timestamptz not null default now(),
  finished_at timestamptz,

  constraint event_processing_attempts_source_kind_valid check (
    source_kind = 'REAL_RAZORPAY_WEBHOOK'
  ),
  constraint event_processing_attempts_status_valid check (
    status in (
      'PENDING', 'HELD', 'PROCESSING', 'SUCCEEDED', 'FAILED',
      'SKIPPED_DUPLICATE'
    )
  ),
  constraint event_processing_attempts_real_webhook_requires_event check (
    source_kind <> 'REAL_RAZORPAY_WEBHOOK' or webhook_event_id is not null
  ),
  constraint event_processing_attempts_normalized_event_is_object check (
    jsonb_typeof(normalized_event) = 'object'
  )
);

comment on table public.event_processing_attempts is
  'Phase 2E — durable processing-attempt identity, separate from '
  'webhook_events'' external event identity (docs/ARCHITECTURE.md '
  'ADR-A09). Phase 2E creates only PENDING/FAILED/SKIPPED_DUPLICATE rows; '
  'PROCESSING/SUCCEEDED are Phase 2F''s to use. source_kind is '
  'CHECK-fixed to REAL_RAZORPAY_WEBHOOK for Phase 2 — '
  'PAYCHAOS_REPLAY/PAYCHAOS_SIMULATION/TEST_FIXTURE remain pre-approved '
  'but unused until Phase 3. chaos_run_id/fault_action/state_before/'
  'state_after are deliberately NOT present — Phase 3 additive columns '
  'per docs/DATABASE.md Section 14 Phase Ownership.';

comment on column public.event_processing_attempts.normalized_event is
  'Safe normalized processor input (lib/events/normalization.ts) — never '
  'PII/instrument data, never the raw webhook body. See '
  'webhook_events.raw_payload_redacted for the source evidence this is '
  'derived from.';

comment on column public.event_processing_attempts.error_message_redacted is
  'A safe, deterministic description only (e.g. "missing payment.id") — '
  'never a raw database error, secret, signature, or raw webhook body.';

-- Required indexes — docs/DATABASE.md Section 13 "Indexes" list for
-- event_processing_attempts (chaos_run_id omitted: that column does not
-- exist until Phase 3).
create index event_processing_attempts_webhook_event_id_idx on public.event_processing_attempts (webhook_event_id);
create index event_processing_attempts_payment_attempt_id_idx on public.event_processing_attempts (payment_attempt_id);
create index event_processing_attempts_payment_id_idx on public.event_processing_attempts (payment_id);
create index event_processing_attempts_source_kind_started_at_idx on public.event_processing_attempts (source_kind, started_at);
create index event_processing_attempts_status_idx on public.event_processing_attempts (status);

-- ============================================================================
-- ROW LEVEL SECURITY AND PRIVILEGES  (docs/DATABASE.md Section 40,
-- docs/SECURITY.md Section 25)
--
-- Same explicit, source-controlled access model already used by every
-- prior P0 migration: RLS enabled with zero policies (denies all access
-- to anon/authenticated by default), privileges additionally REVOKEd
-- explicitly rather than relying on the absence of a GRANT alone, and
-- narrow explicit CRUD GRANTs to `service_role` only.
-- ============================================================================

alter table public.event_processing_attempts enable row level security;

revoke all privileges on table public.event_processing_attempts from anon, authenticated;

grant select, insert, update, delete on public.event_processing_attempts to service_role;
