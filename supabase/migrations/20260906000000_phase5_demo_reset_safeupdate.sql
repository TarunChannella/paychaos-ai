-- ============================================================================
-- Phase 5 — Demo Reset: safeupdate compatibility.
--
-- WHY THIS MIGRATION EXISTS (a confirmed production defect).
--
-- The atomic reset function added by migration 14 is correct about ORDER and
-- correct about ATOMICITY, and it succeeds when run from the Supabase SQL
-- editor. Through the application it failed every time:
--
--     provider_error_code = 21000
--     postgres message    = "DELETE requires a WHERE clause"
--
-- That is Supabase's `safeupdate` protection. It rejects any DELETE (or
-- UPDATE) that carries no WHERE clause when executed in the API role's
-- context, precisely to stop an accidental whole-table wipe. Migration 14's
-- statements were the unconditional form:
--
--     delete from public.fulfilments;
--
-- which is exactly the shape safeupdate exists to refuse.
--
-- THE PROTECTION IS RIGHT; THE FUNCTION WAS WRONG. safeupdate stays enabled.
-- Nothing is disabled globally, per role, per database, or temporarily inside
-- this function. A reset that switched the guard off for its own convenience
-- would remove the protection from every other statement running in that
-- session, to work around a rule this function should simply satisfy.
--
-- THE FIX. Every DELETE now carries an explicit predicate over the table's
-- primary key:
--
--     delete from public.<table> where id is not null;
--
-- Each of the ten runtime tables declares `id uuid primary key`, and PRIMARY
-- KEY implies NOT NULL, so the predicate is true for every row that exists:
-- the statement still deletes the whole table, and no row can hide behind it.
-- Each table's own primary-key declaration was checked before this form was
-- used, rather than assumed.
--
-- `where id is not null` is deliberately preferred over `where true`. It is
-- tied to a column the schema guarantees is non-null, so its always-true-ness
-- is a property of the data rather than of a literal, and it states plainly
-- which key the sweep is over.
--
-- WHAT IS UNCHANGED. The child-before-parent order, the ten-table scope, the
-- single-transaction atomicity, the absence of an EXCEPTION handler, the
-- zero-argument signature, the jsonb return, the row-count collection,
-- `security invoker`, the pinned `search_path`, and the grants. This is a
-- CREATE OR REPLACE of the same function: no table, column, index, RLS
-- policy or configuration is touched, and migration 14 is not edited.
-- ============================================================================

create or replace function public.reset_paychaos_demo_runtime()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_deleted bigint;
begin
  -- Child-before-parent, derived from the deployed foreign-key graph and
  -- unchanged from migration 14. Every predicate below is `id is not null`,
  -- which is always true for an existing row because `id` is the primary key.
  --
  -- `fulfilments` is FIRST: it references orders, payments AND
  -- event_processing_attempts, so nothing it points at may be removed first.
  delete from public.fulfilments where id is not null;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('fulfilments', v_deleted);

  -- regression_runs references findings and chaos_runs.
  delete from public.regression_runs where id is not null;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('regression_runs', v_deleted);

  -- event_processing_attempts references webhook_events, payment_attempts,
  -- payments and chaos_runs. Safe only now that fulfilments is empty.
  delete from public.event_processing_attempts where id is not null;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('event_processing_attempts', v_deleted);

  -- findings references invariant_results.
  delete from public.findings where id is not null;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('findings', v_deleted);

  -- invariant_results references orders, payment_attempts, payments,
  -- chaos_runs.
  delete from public.invariant_results where id is not null;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('invariant_results', v_deleted);

  -- chaos_runs references orders, payment_attempts, payments, webhook_events.
  delete from public.chaos_runs where id is not null;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('chaos_runs', v_deleted);

  -- webhook_events references payment_attempts and payments.
  delete from public.webhook_events where id is not null;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('webhook_events', v_deleted);

  -- payments references payment_attempts.
  delete from public.payments where id is not null;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('payments', v_deleted);

  -- payment_attempts references orders.
  delete from public.payment_attempts where id is not null;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('payment_attempts', v_deleted);

  -- orders is the root: nothing among the ten is left to reference it.
  delete from public.orders where id is not null;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('orders', v_deleted);

  return v_counts;
end;
$$;

comment on function public.reset_paychaos_demo_runtime() is
  'Phase 5 — the documented administrative Demo Reset. Deletes exactly the '
  'ten approved runtime tables in verified child-before-parent order inside '
  'ONE transaction, so a reset either fully applies or does not apply at '
  'all. Every DELETE carries an explicit primary-key predicate so the '
  'statement satisfies Supabase safeupdate, which refuses an unqualified '
  'DELETE in the API role context; that protection remains enabled and is '
  'never disabled by this function. Takes no arguments: no table name, '
  'predicate or SQL text can be supplied by a caller. Never uses CASCADE or '
  'TRUNCATE. Touches no schema, migration, RLS policy, auth, storage or '
  'configuration.';

-- CREATE OR REPLACE preserves the existing privileges, but they are
-- reasserted here so this file states the complete intended posture on its
-- own rather than depending on a reader consulting migration 14.
revoke all on function public.reset_paychaos_demo_runtime() from public;
revoke all on function public.reset_paychaos_demo_runtime() from anon, authenticated;
grant execute on function public.reset_paychaos_demo_runtime() to service_role;
