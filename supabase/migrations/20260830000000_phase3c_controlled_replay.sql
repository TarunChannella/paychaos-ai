-- PayChaos AI — Phase 3C additive/compatibility migration.
--
-- Architect-approved Phase 2F compatibility fix (Phase 3C preparation
-- review, "Section N" blocker): the frozen Phase 2F
-- `process_webhook_payment_event` transaction unconditionally rejected any
-- `event_processing_attempts` row whose `source_kind` was not exactly
-- `REAL_RAZORPAY_WEBHOOK`. Phase 3C's entire purpose — controlled replay of
-- already-verified Test Mode evidence through that SAME existing processor —
-- cannot function until that admission gate accepts `PAYCHAOS_REPLAY` too.
-- This migration makes that one narrow change via `CREATE OR REPLACE
-- FUNCTION`, plus the additive `event_processing_attempts.chaos_run_id`
-- column and widened `source_kind` CHECK that provenance requires.
--
-- This migration does NOT edit the historical, already-applied
-- 20260827000000_phase2e_webhook_dedup.sql or
-- 20260828000000_phase2f_merchant_processing.sql files — both remain
-- byte-for-byte unchanged on disk. Every change here is either a new
-- ADDITIVE statement (ADD COLUMN, new CHECK constraint, new index) or a
-- `CREATE OR REPLACE FUNCTION` that keeps the exact same signature
-- (`process_webhook_payment_event(uuid)`), so the historical migration
-- files' own CREATE TABLE/CREATE FUNCTION statements are never touched —
-- docs/DATABASE.md Section 44 "Migration Ownership by Phase".
--
-- This migration does NOT enable `PAYCHAOS_SIMULATION` or `TEST_FIXTURE` —
-- both remain approved future target values (docs/DATABASE.md Section 14)
-- that stay unimplemented surface until the later phases that actually
-- produce them (C07/C11 fault mechanisms, fixture work) exist. Enabling
-- them now would be unused, untested surface — the same reasoning the
-- Phase 2E migration itself used to originally defer all three
-- non-REAL_RAZORPAY_WEBHOOK values.
--
-- This migration does NOT create a new table, does NOT widen RLS/GRANT
-- surface beyond the function's existing service_role-only execute grant,
-- and does NOT touch `chaos_runs` (Phase 3B, frozen and approved).
--
-- This migration contains no secrets. It only defines schema, constraints,
-- an index, and a narrowly-revised transactional SQL function.
--
-- NOT APPLIED YET: this file is prepared for later manual/developer-driven
-- application against the real Supabase project, using the same protocol
-- already used for every earlier migration, and only after architect
-- approval of this Phase 3C candidate.

-- ============================================================================
-- event_processing_attempts.chaos_run_id — additive column
-- (docs/DATABASE.md Section 14 "Phase Ownership" pre-approved this as a
-- later, separate additive column; Phase 3B deliberately did not add it —
-- see that migration's own header comment. Phase 3C is that later phase.)
-- ============================================================================

alter table public.event_processing_attempts
  add column chaos_run_id uuid references public.chaos_runs (id) on delete restrict;

comment on column public.event_processing_attempts.chaos_run_id is
  'Phase 3C — the chaos_runs row that requested this processing attempt, '
  'when applicable. NOT NULL for every PAYCHAOS_REPLAY row '
  '(event_processing_attempts_replay_provenance_valid enforces this). '
  'Nullable for REAL_RAZORPAY_WEBHOOK — a genuine provider delivery '
  'ordinarily has none, but this column does not forbid a future Phase 3 '
  'scenario from legitimately correlating real provider processing with a '
  'chaos run; no CHECK constraint requires it to be NULL for '
  'REAL_RAZORPAY_WEBHOOK. See docs/DATABASE.md Section 14.';

create index event_processing_attempts_chaos_run_id_idx
  on public.event_processing_attempts (chaos_run_id);

-- ============================================================================
-- source_kind — narrow widening
--
-- Drops and recreates the Phase 2E CHECK constraint (same constraint name,
-- so this is a genuine replacement, not an addition alongside the old one).
-- Widens from exactly REAL_RAZORPAY_WEBHOOK to exactly
-- {REAL_RAZORPAY_WEBHOOK, PAYCHAOS_REPLAY} — PAYCHAOS_SIMULATION and
-- TEST_FIXTURE remain excluded (see module header comment above). Every
-- existing REAL_RAZORPAY_WEBHOOK row remains valid and unaffected: it is
-- still one of the two now-allowed values.
-- ============================================================================

alter table public.event_processing_attempts
  drop constraint event_processing_attempts_source_kind_valid;

alter table public.event_processing_attempts
  add constraint event_processing_attempts_source_kind_valid check (
    source_kind in ('REAL_RAZORPAY_WEBHOOK', 'PAYCHAOS_REPLAY')
  );

-- ============================================================================
-- PAYCHAOS_REPLAY provenance CHECK
--
-- A PAYCHAOS_REPLAY row references genuine canonical evidence (it must
-- carry the original webhook_event_id) but is explicitly NOT a genuine
-- duplicate HTTP delivery from Razorpay (is_duplicate_delivery must be
-- false), and must always be attributable to the chaos_runs row that
-- requested it (chaos_run_id required). REAL_RAZORPAY_WEBHOOK rows are
-- untouched by this constraint (the existing
-- event_processing_attempts_real_webhook_requires_event constraint already
-- covers their own webhook_event_id requirement, and they never require
-- chaos_run_id).
-- ============================================================================

alter table public.event_processing_attempts
  add constraint event_processing_attempts_replay_provenance_valid check (
    source_kind <> 'PAYCHAOS_REPLAY'
    or (
      webhook_event_id is not null
      and chaos_run_id is not null
      and is_duplicate_delivery = false
    )
  );

-- ============================================================================
-- FUNCTION: process_webhook_payment_event  (architect-approved compatibility
-- revision — Phase 3C's only change to this function)
--
-- CREATE OR REPLACE with the EXACT SAME signature
-- (process_webhook_payment_event(uuid)) as the frozen Phase 2F function, so
-- every existing grant (service_role execute, PUBLIC revoked) is preserved
-- automatically by Postgres — reasserted explicitly below anyway, for the
-- same "explicit over implicit" reason every other migration in this
-- codebase repeats its own grants.
--
-- Every property required to stay identical, stays identical: `language
-- plpgsql`, `security invoker`, `set search_path = public`, the fixed lock
-- order (event_processing_attempts -> webhook_events -> payment_attempts ->
-- orders -> payments), the fail-closed normalized-event envelope
-- validation, the explicit payment.captured/payment.failed/order.paid
-- branches, the fulfilment idempotency (ON CONFLICT), and every RAISE
-- EXCEPTION error code. `normalized_event.sourceKind` must still equal
-- REAL_RAZORPAY_WEBHOOK (line "if v_norm_source_kind is distinct from
-- 'REAL_RAZORPAY_WEBHOOK'" — UNCHANGED) — a replayed attempt copies the
-- ORIGINAL normalized_event verbatim, which already carries that value
-- truthfully (it describes the evidence's origin, not who is replaying it).
-- The correlated canonical `webhook_events` row must still be
-- `source_kind = REAL_RAZORPAY_WEBHOOK` and `signature_verified = true`
-- (UNCHANGED) — a replay's canonical webhook_events row is the SAME
-- original row, never rewritten.
--
-- The ONLY semantic change (search for "Phase 3C" below): the processing
-- ATTEMPT's own provenance admission gate now accepts `PAYCHAOS_REPLAY` in
-- addition to `REAL_RAZORPAY_WEBHOOK` — and, when it is `PAYCHAOS_REPLAY`,
-- additionally requires `chaos_run_id is not null` and
-- `is_duplicate_delivery = false` (mirroring
-- event_processing_attempts_replay_provenance_valid as defense-in-depth
-- inside the transaction itself, not merely relying on the table CHECK).
-- Both source kinds still require `webhook_event_id is not null`. The
-- deterministic safe failure code for a rejected attempt provenance stays
-- `PROCESSING_SOURCE_INVALID` — no new error code was needed.
-- ============================================================================

create or replace function public.process_webhook_payment_event(
  p_processing_attempt_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_attempt public.event_processing_attempts%rowtype;
  v_webhook public.webhook_events%rowtype;
  v_payment_attempt public.payment_attempts%rowtype;
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_normalized jsonb;
  v_kind text;
  v_norm_source_kind text;
  v_norm_event_type text;
  v_norm_order_id text;
  v_norm_payment_id text;
  v_norm_amount bigint;
  v_norm_currency text;
  v_norm_payment_status text;
  v_now timestamptz := now();
  v_fulfilment_id uuid;
  v_idempotency_key text;
  v_existing_fulfilment public.fulfilments%rowtype;
  v_already_captured boolean;
begin
  -- 1. Lock the target processing-attempt row before deciding whether it
  -- may be processed — this is the serialization boundary for two callers
  -- racing on the SAME processing attempt id.
  select * into v_attempt
  from public.event_processing_attempts
  where id = p_processing_attempt_id
  for update;

  if not found then
    raise exception 'PROCESSING_ATTEMPT_NOT_FOUND: processing attempt % does not exist', p_processing_attempt_id;
  end if;

  if v_attempt.status = 'SUCCEEDED' then
    -- Idempotent success: derive and return the prior result WITHOUT any
    -- mutation. A caller retrying an already-succeeded attempt (e.g. a
    -- duplicate-delivery redelivery routed back through the same attempt
    -- id) must be a safe no-op. No further locks are taken on this path —
    -- nothing is mutated.
    v_kind := coalesce(v_attempt.normalized_event->>'eventType', v_attempt.normalized_event->>'kind');

    if v_attempt.payment_attempt_id is not null then
      select * into v_payment_attempt
      from public.payment_attempts
      where id = v_attempt.payment_attempt_id;
    end if;

    v_fulfilment_id := null;
    if v_payment_attempt.order_id is not null then
      select id into v_fulfilment_id
      from public.fulfilments
      where idempotency_key = 'FULFIL_ORDER:' || v_payment_attempt.order_id::text;
    end if;

    return jsonb_build_object(
      'outcome', 'already_processed',
      'event_type', v_kind,
      'order_id', v_payment_attempt.order_id,
      'payment_id', v_attempt.payment_id,
      'fulfilment_id', v_fulfilment_id
    );
  end if;

  -- PENDING and PROCESSING are BOTH safe to (re)process here through the
  -- exact same idempotent logic below — a durably-persisted PROCESSING row
  -- must be recoverable, not permanently stuck. HELD/FAILED/
  -- SKIPPED_DUPLICATE remain rejected: HELD is not normally produced and
  -- must never be falsely acknowledged as successful; FAILED must not be
  -- silently reprocessed by this same historical attempt (a retry must go
  -- through a new attempt); SKIPPED_DUPLICATE must never be treated as
  -- authoritative.
  if v_attempt.status not in ('PENDING', 'PROCESSING') then
    raise exception 'PROCESSING_ATTEMPT_NOT_READY: processing attempt % has status % and cannot be processed', p_processing_attempt_id, v_attempt.status;
  end if;

  -- Phase 3C: the processing-ATTEMPT provenance admission gate now accepts
  -- PAYCHAOS_REPLAY in addition to REAL_RAZORPAY_WEBHOOK. Both still
  -- require webhook_event_id. PAYCHAOS_REPLAY additionally requires
  -- chaos_run_id and a non-duplicate-delivery marker — mirroring
  -- event_processing_attempts_replay_provenance_valid as defense-in-depth.
  -- This is the ONLY semantic admission change Phase 3C makes anywhere in
  -- this function.
  if v_attempt.webhook_event_id is null
     or v_attempt.source_kind not in ('REAL_RAZORPAY_WEBHOOK', 'PAYCHAOS_REPLAY')
     or (
       v_attempt.source_kind = 'PAYCHAOS_REPLAY'
       and (v_attempt.chaos_run_id is null or v_attempt.is_duplicate_delivery is not false)
     )
  then
    raise exception 'PROCESSING_SOURCE_INVALID: processing attempt % does not carry valid REAL_RAZORPAY_WEBHOOK or PAYCHAOS_REPLAY evidence', p_processing_attempt_id;
  end if;

  -- Conceptually PENDING/PROCESSING -> PROCESSING -> SUCCEEDED within one
  -- transaction (a harmless self-assignment when already PROCESSING). This
  -- write only survives if the whole function later returns normally; any
  -- RAISE EXCEPTION below rolls it back along with every other mutation in
  -- this function invocation.
  update public.event_processing_attempts
  set status = 'PROCESSING'
  where id = p_processing_attempt_id;

  -- Fail-closed envelope validation — BEFORE any further lock or mutation.
  -- `normalized_event` is guaranteed to be a JSON object by the table's own
  -- event_processing_attempts_normalized_event_is_object CHECK constraint,
  -- but this is re-asserted here as defense-in-depth rather than relying on
  -- that constraint alone.
  v_normalized := v_attempt.normalized_event;

  if jsonb_typeof(v_normalized) <> 'object' then
    raise exception 'PROCESSING_EVENT_INVALID: normalized event is not a JSON object for attempt %', p_processing_attempt_id;
  end if;

  v_norm_source_kind := v_normalized->>'sourceKind';
  v_norm_event_type := v_normalized->>'eventType';
  v_kind := v_normalized->>'kind';

  -- UNCHANGED from Phase 2F: normalized_event.sourceKind must still equal
  -- REAL_RAZORPAY_WEBHOOK regardless of the processing attempt's own
  -- source_kind. A replayed attempt copies the ORIGINAL normalized_event
  -- verbatim, which already carries this value truthfully — it describes
  -- the evidence's origin, not who is replaying it.
  if v_norm_source_kind is distinct from 'REAL_RAZORPAY_WEBHOOK' then
    raise exception 'PROCESSING_EVENT_INVALID: normalized sourceKind is missing or invalid for attempt %', p_processing_attempt_id;
  end if;

  if v_norm_event_type is null or v_norm_event_type not in ('payment.captured', 'payment.failed', 'order.paid') then
    raise exception 'PROCESSING_EVENT_INVALID: normalized eventType is missing or unsupported for attempt %', p_processing_attempt_id;
  end if;

  if v_kind is null or v_kind not in ('payment.captured', 'payment.failed', 'order.paid') then
    raise exception 'PROCESSING_EVENT_INVALID: normalized kind is missing or unsupported for attempt %', p_processing_attempt_id;
  end if;

  if v_kind <> v_norm_event_type then
    raise exception 'PROCESSING_EVENT_INVALID: normalized kind does not match eventType for attempt %', p_processing_attempt_id;
  end if;

  -- 2. Lock the correlated canonical webhook event.
  select * into v_webhook from public.webhook_events where id = v_attempt.webhook_event_id for update;
  if not found then
    raise exception 'PROCESSING_SOURCE_INVALID: correlated webhook event not found for attempt %', p_processing_attempt_id;
  end if;

  -- Tautological given the WHERE clause above, but asserted explicitly as
  -- defense-in-depth ("webhook.id = processing_attempt.webhook_event_id").
  if v_webhook.id <> v_attempt.webhook_event_id then
    raise exception 'PROCESSING_CORRELATION_INVALID: webhook event identity mismatch for attempt %', p_processing_attempt_id;
  end if;

  -- UNCHANGED from Phase 2F: the correlated canonical webhook_events row
  -- must still be source_kind = REAL_RAZORPAY_WEBHOOK and
  -- signature_verified = true — a replay's canonical webhook_events row is
  -- the SAME original row, never rewritten, so this always holds true for
  -- a genuine replay of authentic evidence.
  if v_webhook.source_kind <> 'REAL_RAZORPAY_WEBHOOK' or v_webhook.signature_verified is not true then
    raise exception 'PROCESSING_SOURCE_INVALID: correlated webhook event for attempt % does not carry valid REAL_RAZORPAY_WEBHOOK evidence', p_processing_attempt_id;
  end if;

  if v_webhook.event_type <> v_norm_event_type then
    raise exception 'PROCESSING_CORRELATION_INVALID: webhook event_type does not match the normalized eventType for attempt %', p_processing_attempt_id;
  end if;

  if v_attempt.payment_attempt_id is null then
    raise exception 'PROCESSING_CORRELATION_INVALID: processing attempt % has no correlated payment attempt', p_processing_attempt_id;
  end if;

  if v_webhook.payment_attempt_id is distinct from v_attempt.payment_attempt_id then
    raise exception 'PROCESSING_CORRELATION_INVALID: webhook payment_attempt_id does not match the processing attempt for attempt %', p_processing_attempt_id;
  end if;

  -- 3. Lock the correlated internal payment attempt.
  select * into v_payment_attempt from public.payment_attempts where id = v_attempt.payment_attempt_id for update;
  if not found then
    raise exception 'PROCESSING_CORRELATION_INVALID: correlated payment attempt not found for attempt %', p_processing_attempt_id;
  end if;

  -- 4. Lock the correlated internal order.
  select * into v_order from public.orders where id = v_payment_attempt.order_id for update;
  if not found then
    raise exception 'PROCESSING_CORRELATION_INVALID: correlated order not found for attempt %', p_processing_attempt_id;
  end if;

  v_norm_order_id := v_normalized->>'razorpayOrderId';
  if v_norm_order_id is null or v_payment_attempt.razorpay_order_id is null or v_norm_order_id <> v_payment_attempt.razorpay_order_id then
    raise exception 'PROCESSING_CORRELATION_INVALID: normalized razorpayOrderId does not match the correlated payment attempt for attempt %', p_processing_attempt_id;
  end if;

  if v_webhook.razorpay_order_id is distinct from v_norm_order_id then
    raise exception 'PROCESSING_CORRELATION_INVALID: webhook razorpay_order_id does not match the normalized event for attempt %', p_processing_attempt_id;
  end if;

  -- Explicit branches only: payment.captured / payment.failed / order.paid
  -- are each handled by name. The final ELSE is unreachable given the
  -- envelope validation above, but is kept as an explicit fail-closed
  -- branch rather than ever treating an unrecognized kind as order.paid
  -- authority.
  if v_kind = 'payment.captured' then
    if v_attempt.payment_id is null then
      raise exception 'PROCESSING_PAYMENT_REQUIRED: processing attempt % has no correlated payment', p_processing_attempt_id;
    end if;

    -- 5. Lock the payment row (same lock order as payment.failed below —
    -- so two concurrent captured/failed calls against the SAME payment
    -- always serialize here).
    select * into v_payment from public.payments where id = v_attempt.payment_id for update;
    if not found then
      raise exception 'PROCESSING_PAYMENT_REQUIRED: correlated payment not found for attempt %', p_processing_attempt_id;
    end if;

    if v_payment.payment_attempt_id <> v_payment_attempt.id then
      raise exception 'PROCESSING_CORRELATION_INVALID: correlated payment does not belong to the correlated payment attempt for attempt %', p_processing_attempt_id;
    end if;

    if v_webhook.payment_id is distinct from v_attempt.payment_id then
      raise exception 'PROCESSING_CORRELATION_INVALID: webhook payment_id does not match the processing attempt for attempt %', p_processing_attempt_id;
    end if;

    v_norm_payment_id := v_normalized->>'razorpayPaymentId';
    if v_norm_payment_id is null or v_norm_payment_id <> v_payment.razorpay_payment_id then
      raise exception 'PROCESSING_CORRELATION_INVALID: normalized razorpayPaymentId does not match the correlated payment for attempt %', p_processing_attempt_id;
    end if;

    if v_webhook.razorpay_payment_id is distinct from v_norm_payment_id then
      raise exception 'PROCESSING_CORRELATION_INVALID: webhook razorpay_payment_id does not match the normalized event for attempt %', p_processing_attempt_id;
    end if;

    v_norm_amount := (v_normalized->>'amountSubunits')::bigint;
    v_norm_currency := v_normalized->>'currency';
    v_norm_payment_status := v_normalized->>'razorpayPaymentStatus';

    if v_norm_amount is null
       or v_norm_amount <> v_payment.amount_subunits
       or v_norm_amount <> v_payment_attempt.amount_subunits
       or v_norm_amount <> v_order.amount_subunits then
      raise exception 'PROCESSING_AMOUNT_MISMATCH: amount_subunits disagree for attempt %', p_processing_attempt_id;
    end if;

    if v_norm_currency is null
       or v_norm_currency <> v_payment.currency
       or v_norm_currency <> v_payment_attempt.currency
       or v_norm_currency <> v_order.currency then
      raise exception 'PROCESSING_CURRENCY_MISMATCH: currency disagree for attempt %', p_processing_attempt_id;
    end if;

    if v_webhook.amount_subunits is distinct from v_norm_amount then
      raise exception 'PROCESSING_CORRELATION_INVALID: webhook amount_subunits does not match the normalized event for attempt %', p_processing_attempt_id;
    end if;

    if v_webhook.currency is distinct from v_norm_currency then
      raise exception 'PROCESSING_CORRELATION_INVALID: webhook currency does not match the normalized event for attempt %', p_processing_attempt_id;
    end if;

    if v_webhook.razorpay_payment_status is distinct from v_norm_payment_status then
      raise exception 'PROCESSING_CORRELATION_INVALID: webhook razorpay_payment_status does not match the normalized event for attempt %', p_processing_attempt_id;
    end if;

    -- Apply captured state, never regress PAID, capture converges even
    -- after a prior failure observation.
    update public.payments
    set razorpay_payment_status = 'captured',
        captured_at = coalesce(captured_at, v_now),
        last_observed_at = v_now,
        updated_at = v_now
    where id = v_payment.id;

    update public.payment_attempts
    set status = 'CAPTURED',
        updated_at = v_now
    where id = v_payment_attempt.id
      and status <> 'CAPTURED';

    update public.orders
    set payment_status = 'PAID',
        updated_at = v_now
    where id = v_order.id
      and payment_status <> 'PAID';

    -- Business-effect idempotency: derive the stable semantic key from the
    -- order id alone (never the processing-attempt/event id), and use an
    -- INSERT ... ON CONFLICT DO UPDATE (a harmless self-assignment) rather
    -- than a SELECT-then-INSERT, so a genuinely concurrent second
    -- transaction attempting the same idempotency_key blocks on the row
    -- lock and observes the FIRST transaction's committed row afterward,
    -- rather than racing past a plain SELECT that hasn't seen an
    -- uncommitted insert yet. This is the exact mechanism that makes TWO
    -- PAYCHAOS_REPLAY attempts against the same order converge to exactly
    -- one fulfilment (Phase 3C's C01 requirement).
    v_idempotency_key := 'FULFIL_ORDER:' || v_order.id::text;

    insert into public.fulfilments (order_id, payment_id, trigger_processing_attempt_id, effect_type, idempotency_key)
    values (v_order.id, v_payment.id, p_processing_attempt_id, 'FULFIL_ORDER', v_idempotency_key)
    on conflict (idempotency_key) do update
      set idempotency_key = excluded.idempotency_key
    returning * into v_existing_fulfilment;

    if v_existing_fulfilment.order_id <> v_order.id
       or v_existing_fulfilment.payment_id <> v_payment.id
       or v_existing_fulfilment.effect_type <> 'FULFIL_ORDER' then
      -- A fulfilment already exists under this order's idempotency key but
      -- disagrees on order/payment/effect-type identity — fail closed
      -- rather than silently accept a conflicting row.
      raise exception 'PROCESSING_FULFILMENT_CONFLICT: an existing fulfilment for order % does not agree with this payment/effect', v_order.id;
    end if;

    v_fulfilment_id := v_existing_fulfilment.id;

    update public.orders
    set business_status = 'FULFILLED',
        updated_at = v_now
    where id = v_order.id
      and business_status <> 'FULFILLED';

  elsif v_kind = 'payment.failed' then
    if v_attempt.payment_id is null then
      raise exception 'PROCESSING_PAYMENT_REQUIRED: processing attempt % has no correlated payment', p_processing_attempt_id;
    end if;

    -- 5. Lock the payment row BEFORE deciding whether capture already
    -- happened (the critical concurrency fix). This is the exact
    -- serialization boundary that makes capture-vs-failure races safe:
    -- whichever transaction (this payment.failed call, or a concurrent
    -- payment.captured call locking the SAME payment row above) acquires
    -- this lock first commits its decision and releases the lock on
    -- COMMIT; the second transaction blocks here until the first commits,
    -- then its own SELECT ... FOR UPDATE always observes the latest
    -- COMMITTED row — never a stale pre-lock snapshot — so
    -- v_already_captured below is always computed from up-to-date state. A
    -- payment.failed transaction can therefore never overwrite a
    -- payment.captured transaction's committed result, regardless of which
    -- one started first.
    select * into v_payment from public.payments where id = v_attempt.payment_id for update;
    if not found then
      raise exception 'PROCESSING_PAYMENT_REQUIRED: correlated payment not found for attempt %', p_processing_attempt_id;
    end if;

    if v_payment.payment_attempt_id <> v_payment_attempt.id then
      raise exception 'PROCESSING_CORRELATION_INVALID: correlated payment does not belong to the correlated payment attempt for attempt %', p_processing_attempt_id;
    end if;

    if v_webhook.payment_id is distinct from v_attempt.payment_id then
      raise exception 'PROCESSING_CORRELATION_INVALID: webhook payment_id does not match the processing attempt for attempt %', p_processing_attempt_id;
    end if;

    v_norm_payment_id := v_normalized->>'razorpayPaymentId';
    if v_norm_payment_id is null or v_norm_payment_id <> v_payment.razorpay_payment_id then
      raise exception 'PROCESSING_CORRELATION_INVALID: normalized razorpayPaymentId does not match the correlated payment for attempt %', p_processing_attempt_id;
    end if;

    if v_webhook.razorpay_payment_id is distinct from v_norm_payment_id then
      raise exception 'PROCESSING_CORRELATION_INVALID: webhook razorpay_payment_id does not match the normalized event for attempt %', p_processing_attempt_id;
    end if;

    v_norm_amount := (v_normalized->>'amountSubunits')::bigint;
    v_norm_currency := v_normalized->>'currency';
    v_norm_payment_status := v_normalized->>'razorpayPaymentStatus';

    if v_norm_amount is null
       or v_norm_amount <> v_payment.amount_subunits
       or v_norm_amount <> v_payment_attempt.amount_subunits
       or v_norm_amount <> v_order.amount_subunits then
      raise exception 'PROCESSING_AMOUNT_MISMATCH: amount_subunits disagree for attempt %', p_processing_attempt_id;
    end if;

    if v_norm_currency is null
       or v_norm_currency <> v_payment.currency
       or v_norm_currency <> v_payment_attempt.currency
       or v_norm_currency <> v_order.currency then
      raise exception 'PROCESSING_CURRENCY_MISMATCH: currency disagree for attempt %', p_processing_attempt_id;
    end if;

    if v_webhook.amount_subunits is distinct from v_norm_amount then
      raise exception 'PROCESSING_CORRELATION_INVALID: webhook amount_subunits does not match the normalized event for attempt %', p_processing_attempt_id;
    end if;

    if v_webhook.currency is distinct from v_norm_currency then
      raise exception 'PROCESSING_CORRELATION_INVALID: webhook currency does not match the normalized event for attempt %', p_processing_attempt_id;
    end if;

    if v_webhook.razorpay_payment_status is distinct from v_norm_payment_status then
      raise exception 'PROCESSING_CORRELATION_INVALID: webhook razorpay_payment_status does not match the normalized event for attempt %', p_processing_attempt_id;
    end if;

    -- Failure observation never fulfils; a stale failure arriving after
    -- authoritative capture must not regress captured/PAID/FULFILLED
    -- state. v_payment was locked above BEFORE this decision — never
    -- computed from a pre-lock read.
    v_already_captured := coalesce(v_payment.razorpay_payment_status = 'captured', false)
      or v_payment.captured_at is not null;

    if not v_already_captured then
      update public.payments
      set razorpay_payment_status = 'failed',
          failed_at = coalesce(failed_at, v_now),
          last_observed_at = v_now,
          error_code = v_normalized->>'errorCode',
          error_source = v_normalized->>'errorSource',
          error_step = v_normalized->>'errorStep',
          error_reason = v_normalized->>'errorReason',
          updated_at = v_now
      where id = v_payment.id;

      update public.payment_attempts
      set status = 'FAILED_OBSERVED',
          updated_at = v_now
      where id = v_payment_attempt.id
        and status <> 'CAPTURED';

      update public.orders
      set payment_status = 'FAILED_OBSERVED',
          updated_at = v_now
      where id = v_order.id
        and payment_status <> 'PAID';
    end if;
    -- Already-captured case: deliberately a safe no-op on payments/
    -- payment_attempts/orders — the verified failure observation is not
    -- retained over stronger capture evidence.

  elsif v_kind = 'order.paid' then
    -- order.paid: corroborating evidence only. Never creates a payments
    -- row, never sets captured state, never fulfils.
    v_norm_amount := (v_normalized->>'amountSubunits')::bigint;
    v_norm_currency := v_normalized->>'currency';

    if v_norm_amount is null
       or v_norm_amount <> v_payment_attempt.amount_subunits
       or v_norm_amount <> v_order.amount_subunits then
      raise exception 'PROCESSING_AMOUNT_MISMATCH: amount_subunits disagree for attempt %', p_processing_attempt_id;
    end if;

    if v_norm_currency is null
       or v_norm_currency <> v_payment_attempt.currency
       or v_norm_currency <> v_order.currency then
      raise exception 'PROCESSING_CURRENCY_MISMATCH: currency disagree for attempt %', p_processing_attempt_id;
    end if;

    if v_webhook.amount_subunits is distinct from v_norm_amount then
      raise exception 'PROCESSING_CORRELATION_INVALID: webhook amount_subunits does not match the normalized event for attempt %', p_processing_attempt_id;
    end if;

    if v_webhook.currency is distinct from v_norm_currency then
      raise exception 'PROCESSING_CORRELATION_INVALID: webhook currency does not match the normalized event for attempt %', p_processing_attempt_id;
    end if;

    if v_attempt.payment_id is not null then
      -- 5. Lock the payment row too, when order.paid carries an optional
      -- correlated payment — validate it belongs to the same payment
      -- attempt rather than trusting it uncorrelated.
      select * into v_payment from public.payments where id = v_attempt.payment_id for update;
      if not found then
        raise exception 'PROCESSING_CORRELATION_INVALID: correlated payment not found for attempt %', p_processing_attempt_id;
      end if;

      if v_payment.payment_attempt_id <> v_payment_attempt.id then
        raise exception 'PROCESSING_CORRELATION_INVALID: correlated payment does not belong to the correlated payment attempt for attempt %', p_processing_attempt_id;
      end if;

      if v_webhook.payment_id is distinct from v_attempt.payment_id then
        raise exception 'PROCESSING_CORRELATION_INVALID: webhook payment_id does not match the processing attempt for attempt %', p_processing_attempt_id;
      end if;
    end if;

    update public.payment_attempts
    set razorpay_order_status = 'paid',
        updated_at = v_now
    where id = v_payment_attempt.id;

  else
    -- Unreachable given the envelope validation above — kept as an
    -- explicit, fail-closed branch rather than ever treating an
    -- unrecognized/corrupted kind as order.paid authority.
    raise exception 'PROCESSING_EVENT_INVALID: unsupported normalized kind % for attempt %', v_kind, p_processing_attempt_id;
  end if;

  update public.event_processing_attempts
  set status = 'SUCCEEDED',
      finished_at = v_now,
      payment_id = coalesce(payment_id, v_payment.id),
      error_code = null,
      error_message_redacted = null
  where id = p_processing_attempt_id;

  update public.webhook_events
  set processing_status = 'PROCESSED',
      processed_at = coalesce(processed_at, v_now),
      updated_at = v_now
  where id = v_webhook.id
    and processing_status <> 'PROCESSED';

  return jsonb_build_object(
    'outcome', 'processed',
    'event_type', v_kind,
    'order_id', v_order.id,
    'payment_id', v_payment.id,
    'fulfilment_id', v_fulfilment_id
  );
end;
$$;

comment on function public.process_webhook_payment_event(uuid) is
  'Phase 2F (2026-08-29 architect review correction), Phase 3C compatibility '
  'revision (2026-08-30) — the single narrow transaction that applies '
  'authoritative merchant/payment state from one durably normalized, '
  'correlated event_processing_attempts row. One invocation is one '
  'transaction: either every protected mutation commits together, or none '
  'of them do. Phase 3C''s ONLY change: the processing-attempt provenance '
  'admission gate now also accepts source_kind = PAYCHAOS_REPLAY (requiring '
  'chaos_run_id and is_duplicate_delivery = false) alongside '
  'REAL_RAZORPAY_WEBHOOK — every other validation, lock order, and mutation '
  'is byte-for-byte identical to the frozen Phase 2F function. '
  'normalized_event.sourceKind and the correlated webhook_events row must '
  'still independently be REAL_RAZORPAY_WEBHOOK/signature_verified — a '
  'replay never rewrites either.';

-- Re-asserted explicitly (Postgres already preserves these across CREATE OR
-- REPLACE FUNCTION with an unchanged signature) — same "explicit over
-- implicit" convention every migration in this codebase follows for its own
-- grants. No permission surface is widened: still service_role execute
-- only, still revoked from PUBLIC/anon/authenticated.
revoke all on function public.process_webhook_payment_event(uuid) from public;
grant execute on function public.process_webhook_payment_event(uuid) to service_role;
