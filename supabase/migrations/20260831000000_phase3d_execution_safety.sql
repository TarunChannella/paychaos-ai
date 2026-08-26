-- PayChaos AI — Phase 3D-0 additive migration: execution-block audit +
-- C07 concurrency schema foundation ONLY.
--
-- This migration does NOT execute anything. It does not add C03 execution,
-- C07 arm/consume/reconcile logic, C07 checkout suppression, C11, fixture
-- processing, invariant evaluation, findings, or any generic chaos
-- execution API. Those all remain later Phase 3D substeps (3D-A/3D-B/3D-C
-- onward), not yet approved. This migration is purely additive: it does not
-- edit, rewrite, or squash 20260829000000_phase3b_chaos_runs.sql or
-- 20260830000000_phase3c_controlled_replay.sql — both remain byte-for-byte
-- unchanged on disk.
--
-- ============================================================================
-- A. execution_block_code
-- ============================================================================
--
-- Phase 3A's `failed_precheck_id` (PRECHECK-01..10) records a CREATION-TIME
-- block — a chaos run request that never became a persisted PENDING run.
-- docs/SECURITY.md's PRE-SEC-xxx catalogue is a DIFFERENT, later,
-- EXECUTION-TIME list: the checks performed immediately before a mechanism
-- actually runs against an already-persisted PENDING run. Until now, a
-- truthful audit record for an execution-time PRE-SEC block had nowhere to
-- go — `chaos_runs_blocked_state_consistent` only ever accepted
-- `failed_precheck_id`. `execution_block_code` is that missing column.
--
-- Scoped to exactly `PRE-SEC-007` for now (required server secrets exist,
-- checked immediately before fault execution) — the only PRE-SEC check that
-- is (a) genuinely execution-time, (b) not already covered by a PRECHECK-xx
-- id, and (c) actually needed by a chaos run persisted this early. PRE-SEC-010
-- is deliberately excluded: it is an HTTP/session authorization boundary
-- enforced before the execution service is allowed to act on the
-- already-persisted chaos_run (docs/SECURITY.md) — the chaos_run row already
-- exists at that point (PRE-SEC-011 requires durable audit before
-- execution); PRE-SEC-010 is not represented as an execution_block_code.
-- PRE-SEC-011 is deliberately excluded: it is structurally satisfied by the
-- mere existence of the already-persisted chaos_run itself (docs/DATABASE.md
-- Section 15's "audit path satisfying PRE-SEC-011") — it is never a distinct
-- block reason. This migration does not invent a generic security-code
-- catalogue; it adds exactly the one value Phase 3D-0 has a genuine use for.
alter table public.chaos_runs
  add column execution_block_code text;

comment on column public.chaos_runs.execution_block_code is
  'Phase 3D-0 — which execution-time PRE-SEC-xxx check (docs/SECURITY.md) '
  'blocked this run immediately before mechanism execution began. Distinct '
  'from failed_precheck_id, which records a Phase 3A CREATION-TIME '
  'PRECHECK-01..10 block on a request that never became a PENDING run. '
  'Currently supports PRE-SEC-007 (required server secrets exist) only — '
  'PRE-SEC-010 is an HTTP/session authorization boundary enforced before the '
  'execution service is allowed to act on the already-persisted chaos_run; '
  'it is not represented as an execution_block_code. PRE-SEC-011 is '
  'structurally satisfied by this row''s own existence; neither ever '
  'populates this column. NULL for every run this column does not apply to.';

alter table public.chaos_runs
  add constraint chaos_runs_execution_block_code_valid check (
    execution_block_code is null or execution_block_code in ('PRE-SEC-007')
  );

-- ============================================================================
-- B. BLOCKED-state consistency — widened for execution_block_code
-- ============================================================================
--
-- Replaces chaos_runs_blocked_state_consistent (Phase 3B). Preserves every
-- existing valid Phase 3B/3A BLOCKED row shape unchanged: a BLOCKED row
-- with failed_precheck_id set and execution_block_code NULL is exactly the
-- old accepted shape. The new shape a BLOCKED row may ALSO take is
-- execution_block_code set and failed_precheck_id NULL — never both, never
-- neither. PRECHECK-01..10 meaning is unchanged.
alter table public.chaos_runs
  drop constraint chaos_runs_blocked_state_consistent;

alter table public.chaos_runs
  add constraint chaos_runs_blocked_state_consistent check (
    (
      outcome = 'BLOCKED'
      and status = 'COMPLETED'
      and (
        (failed_precheck_id is not null and execution_block_code is null)
        or
        (failed_precheck_id is null and execution_block_code is not null)
      )
      and error_message_redacted is not null
      and started_at is null
      and completed_at is not null
    )
    or (
      outcome is distinct from 'BLOCKED'
      and failed_precheck_id is null
      and execution_block_code is null
    )
  );

-- ============================================================================
-- C. PENDING-state consistency — widened for execution_block_code
-- ============================================================================
--
-- Replaces chaos_runs_pending_state_consistent (Phase 3B). Adds
-- execution_block_code IS NULL to the existing PENDING requirement; every
-- other lifecycle rule is unchanged.
alter table public.chaos_runs
  drop constraint chaos_runs_pending_state_consistent;

alter table public.chaos_runs
  add constraint chaos_runs_pending_state_consistent check (
    status <> 'PENDING'
    or (
      outcome is null
      and failed_precheck_id is null
      and execution_block_code is null
      and started_at is null
      and completed_at is null
    )
  );

-- ============================================================================
-- D. C07 active-fault concurrency boundary
-- ============================================================================
--
-- Database-enforced: at most one RUNNING C07/DROP_CLIENT_CONFIRMATION chaos
-- run per order at any time. A partial UNIQUE index, not a table-level lock
-- and not an application-level `if` check — this project's existing
-- principle that PostgreSQL, not application code alone, must protect a
-- concurrency invariant it can enforce (docs/ARCHITECTURE.md Section 25).
-- Scoped by the partial predicate to exactly RUNNING C07/
-- DROP_CLIENT_CONFIRMATION rows with a non-null order_id — it has zero
-- effect on C01/C03/C11 rows, on C07 rows in PENDING/COMPLETED/FAILED, or on
-- RUNNING C07 rows for a different order. Once a run leaves RUNNING (any
-- terminal status), the index no longer counts it, so a later run for the
-- same order may become RUNNING again — this is a concurrency boundary, not
-- a permanent one-run-per-order limit.
create unique index chaos_runs_one_active_c07_fault_per_order_idx
  on public.chaos_runs (order_id)
  where scenario_id = 'C07'
    and fault_type = 'DROP_CLIENT_CONFIRMATION'
    and status = 'RUNNING'
    and order_id is not null;
