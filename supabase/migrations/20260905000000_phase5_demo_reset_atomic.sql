-- ============================================================================
-- Phase 5 — Demo Reset: dependency-safe and ATOMIC.
--
-- WHY THIS MIGRATION EXISTS (a confirmed production defect).
--
-- The Demo Reset was implemented as ten independent Supabase DELETE requests
-- issued in a loop from application code. That design has two faults, and a
-- real production reset hit both:
--
--   1. WRONG ORDER. The frozen list deleted `event_processing_attempts`
--      BEFORE `fulfilments`. But `fulfilments.trigger_processing_attempt_id`
--      references `event_processing_attempts (id) ON DELETE RESTRICT`, added
--      by the Phase 2F migration. Any fulfilment produced by a webhook — the
--      normal case — therefore pins its processing attempt, and the delete
--      is refused by PostgreSQL.
--
--   2. NO TRANSACTION. Because each DELETE was its own request, the four
--      that ran before the failure had already COMMITTED. The database was
--      left partially reset, which is precisely the state a reset exists to
--      make impossible.
--
-- Every one of the twenty-two foreign keys among the ten runtime tables is
-- ON DELETE RESTRICT (deliberately: evidence must never vanish silently), so
-- deletion order is a correctness property, not a preference.
--
-- WHAT THIS FUNCTION IS.
--
-- One narrow, argument-less function that deletes exactly the ten approved
-- runtime tables in a verified child-before-parent order, inside a single
-- transaction. A function call runs within the caller's statement, so if any
-- DELETE raises, the entire function is aborted and every earlier DELETE in
-- it rolls back. Partial reset stops being representable.
--
-- WHAT IT DELIBERATELY IS NOT.
--
--   * It takes NO arguments — no table name, no predicate, no SQL text. A
--     caller can run exactly this, or nothing.
--   * `language plpgsql` with ten literal statements. No dynamic SQL, no
--     EXECUTE, no format(), no string concatenation, nothing to inject into.
--   * No CASCADE and no TRUNCATE: both would silently delete rows outside
--     the approved ten if the schema ever grew a new referencing table.
--     A RESTRICT violation SHOULD fail loudly.
--   * No DROP, no ALTER, no schema/RLS/auth/storage/config/secret access.
--
-- STATEMENT ORDER IS NOT INTERCHANGEABLE. This is plpgsql rather than a
-- single SQL statement of data-modifying CTEs on purpose: CTEs execute in an
-- unspecified order against one snapshot, which is unsafe when immediate
-- RESTRICT checks make sequencing mandatory.
--
-- `security invoker`, matching the Phase 2E precedent: the only caller is the
-- trusted server credential, `service_role` already holds DELETE on all ten
-- tables from their own migrations, so no privilege elevation is needed and
-- no `search_path`-hijack surface is created. `search_path` is pinned anyway
-- as defence in depth.
--
-- ADDITIVE ONLY. This migration creates one function and its grants. It
-- alters no table, no column, no index, no RLS policy and no existing grant.
-- ============================================================================

create function public.reset_paychaos_demo_runtime()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_deleted bigint;
begin
  -- Child-before-parent, derived from the deployed foreign-key graph.
  -- `fulfilments` is FIRST: it references orders, payments AND
  -- event_processing_attempts, so nothing it points at may be removed first.
  delete from public.fulfilments;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('fulfilments', v_deleted);

  -- regression_runs references findings and chaos_runs.
  delete from public.regression_runs;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('regression_runs', v_deleted);

  -- event_processing_attempts references webhook_events, payment_attempts,
  -- payments and chaos_runs. Safe only now that fulfilments is empty.
  delete from public.event_processing_attempts;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('event_processing_attempts', v_deleted);

  -- findings references invariant_results.
  delete from public.findings;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('findings', v_deleted);

  -- invariant_results references orders, payment_attempts, payments,
  -- chaos_runs.
  delete from public.invariant_results;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('invariant_results', v_deleted);

  -- chaos_runs references orders, payment_attempts, payments, webhook_events.
  delete from public.chaos_runs;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('chaos_runs', v_deleted);

  -- webhook_events references payment_attempts and payments.
  delete from public.webhook_events;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('webhook_events', v_deleted);

  -- payments references payment_attempts.
  delete from public.payments;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('payments', v_deleted);

  -- payment_attempts references orders.
  delete from public.payment_attempts;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('payment_attempts', v_deleted);

  -- orders is the root: nothing among the ten is left to reference it.
  delete from public.orders;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('orders', v_deleted);

  return v_counts;
end;
$$;

comment on function public.reset_paychaos_demo_runtime() is
  'Phase 5 — the documented administrative Demo Reset. Deletes exactly the '
  'ten approved runtime tables in verified child-before-parent order inside '
  'ONE transaction, so a reset either fully applies or does not apply at '
  'all. Takes no arguments: no table name, predicate or SQL text can be '
  'supplied by a caller. Never uses CASCADE or TRUNCATE — a foreign-key '
  'violation must fail loudly rather than silently widen the blast radius. '
  'Touches no schema, migration, RLS policy, auth, storage or configuration.';

-- Postgres grants EXECUTE on new functions to PUBLIC by default — revoke
-- that, then grant only to service_role. Neither anon nor authenticated may
-- ever reset the demo.
revoke all on function public.reset_paychaos_demo_runtime() from public;
revoke all on function public.reset_paychaos_demo_runtime() from anon, authenticated;
grant execute on function public.reset_paychaos_demo_runtime() to service_role;
