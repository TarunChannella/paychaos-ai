-- ============================================================================
-- Phase 5 — Controlled C01 vulnerable Demo Merchant profile.
--
-- WHY THIS MIGRATION EXISTS. docs/DEMO_PLAN.md Section 9 ("Deliberately
-- Vulnerable Demo Merchant") and docs/CHAOS_SCENARIOS.md Section 43
-- ("Vulnerable Demo Profiles") both REQUIRE an operator-controlled vulnerable
-- merchant profile for the frozen primary demonstration in
-- docs/CHAOS_SCENARIOS.md Section 44. The behaviour was specified but never
-- implemented, so C01 could only ever produce PASS/UNKNOWN and the documented
-- FAIL -> Finding -> Diagnosis -> Recommendation -> Regression -> Resolution
-- story could not be shown. This migration closes that documented gap.
--
-- THE MECHANISM IS THE ONE THE DOCUMENTATION PRESCRIBES, VERBATIM:
--
--     Buggy profile:
--     idempotency key incorrectly includes processing attempt ID
--
--     Fixed profile:
--     stable semantic idempotency key based on order/business effect
--
-- and NOT the approach the same section explicitly forbids:
--
--     Bad example:
--     Disable database constraints globally
--
-- No constraint is dropped, disabled or deferred here. The fulfilments
-- UNIQUE(idempotency_key) constraint stays enabled and keeps behaving
-- exactly as it always has. Under the vulnerable profile the merchant simply
-- computes a key that is not stable, so the constraint has nothing to match
-- — which is exactly how this bug presents in a real integration.
--
-- WHAT THIS MIGRATION DOES NOT TOUCH: webhook signature verification, the
-- REAL_RAZORPAY_WEBHOOK processing path, payment truth, the invariant
-- engine, finding generation, RLS on any existing table, or any grant.
--
-- This migration contains no secrets.
-- ============================================================================


-- ============================================================================
-- 1. demo_merchant_profile — the authoritative server-side profile
-- ============================================================================
-- A SINGLETON. An `id boolean primary key` with a CHECK pinning it to `true`
-- makes a second row structurally impossible, so "the current profile" is
-- never ambiguous and no caller has to pick a row. The server is the only
-- authority: the UI reads this value and never decides it.

create table public.demo_merchant_profile (
  id boolean primary key default true,

  c01_idempotency_profile text not null default 'SAFE',

  updated_at timestamptz not null default now(),

  constraint demo_merchant_profile_singleton check (id = true),

  constraint demo_merchant_profile_c01_valid check (
    c01_idempotency_profile in ('SAFE', 'VULNERABLE_IDEMPOTENCY')
  )
);

comment on table public.demo_merchant_profile is
  'Phase 5 — the operator-controlled Demo Merchant test-behaviour profile '
  'required by docs/DEMO_PLAN.md Section 9 and docs/CHAOS_SCENARIOS.md '
  'Section 43. Exactly one row (enforced by the singleton CHECK). Holds no '
  'secret, no credential and no payment data. Default is SAFE and Demo '
  'Reset restores SAFE, so a vulnerable profile can never survive a reset.';

comment on column public.demo_merchant_profile.c01_idempotency_profile is
  'SAFE (default) = the merchant derives a stable semantic fulfilment '
  'idempotency key from the order id, so a duplicate C01 replay converges '
  'to exactly one fulfilment. VULNERABLE_IDEMPOTENCY = the controlled '
  'documented defect, where the key incorrectly includes the processing '
  'attempt id. Read ONLY on the PAYCHAOS_REPLAY path of a C01 chaos run '
  '(see process_webhook_payment_event); it can never affect a real '
  'REAL_RAZORPAY_WEBHOOK delivery, C03, C07 or C11.';

-- The singleton row. `on conflict do nothing` keeps this migration
-- re-runnable without ever resetting an operator's current choice.
insert into public.demo_merchant_profile (id, c01_idempotency_profile)
values (true, 'SAFE')
on conflict (id) do nothing;

-- Same posture as every other table in this schema, and deliberately BOTH
-- layers rather than either alone:
--
--   1. RLS enabled with no policy — anon/authenticated are denied every row
--      regardless of what table privileges they may hold.
--   2. Explicit privilege statements — the repository's established
--      convention (see chaos_runs, findings, and the other eight tables).
--      Relying on RLS alone would also have left service_role's access to
--      depend on whatever default privileges the project happens to carry,
--      which is not something a P0 capability should be gambling on.
--
-- A browser can never flip this profile directly; it must go through the
-- authorized server route.
alter table public.demo_merchant_profile enable row level security;

revoke all privileges on table public.demo_merchant_profile from anon, authenticated;

-- Deliberately NARROWER than the runtime tables' select/insert/update/delete.
-- The singleton row is seeded by this migration, and the reset RESTORES it
-- rather than deleting it, so the server never needs INSERT or DELETE here.
-- A missing row fails closed (PROFILE_TABLE_UNAVAILABLE) instead of being
-- silently re-created, which would mask a broken deployment.
grant select, update on public.demo_merchant_profile to service_role;


-- ============================================================================
-- 2. process_webhook_payment_event — the controlled vulnerable branch
-- ============================================================================
-- Replaces the Phase 3C definition. The ONLY behavioural change is the
-- guarded idempotency-key block marked "CONTROLLED C01 DEMO VULNERABILITY".
-- Every other statement, error code, lock order and return shape is
-- byte-for-byte the Phase 3C function.

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
  -- Controlled C01 demo profile lookup (see the block at the fulfilment
  -- insert below). Declared here only; read ONLY on the replay path.
  v_replay_scenario_id text;
  v_c01_profile text;
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

    -- ------------------------------------------------------------------
    -- CONTROLLED C01 DEMO VULNERABILITY
    -- docs/CHAOS_SCENARIOS.md Section 43, docs/DEMO_PLAN.md Section 9.
    --
    -- Reproduces the exact merchant bug the documentation prescribes:
    --   buggy profile: idempotency key incorrectly includes processing
    --                  attempt ID
    --   fixed profile: stable semantic key based on order/business effect
    --
    -- Every replay allocates a NEW processing attempt, so a key built from
    -- that id differs every time, the UNIQUE(idempotency_key) constraint
    -- never matches, and a SECOND fulfilment row is inserted. That is a
    -- genuine merchant-side idempotency defect reached WITHOUT disabling a
    -- single database constraint: the unique index stays enabled and keeps
    -- working exactly as before. It simply is not protecting anything,
    -- which is precisely the real-world bug being demonstrated.
    --
    -- FOUR CONDITIONS, ALL REQUIRED, ALL SERVER-SIDE:
    --   1. attempt provenance is PAYCHAOS_REPLAY. A real provider delivery
    --      is REAL_RAZORPAY_WEBHOOK and can never enter here, so ordinary
    --      webhook processing is structurally unreachable from this branch.
    --   2. the attempt belongs to a chaos run (constraint-guaranteed for a
    --      PAYCHAOS_REPLAY row).
    --   3. that run is scenario C01. C03, C07 and C11 cannot enter.
    --   4. an operator has explicitly persisted VULNERABLE_IDEMPOTENCY.
    --      The default is SAFE and Demo Reset restores SAFE.
    --
    -- Razorpay Test Mode is enforced above this layer and is structural:
    -- the application refuses to start unless RAZORPAY_MODE=test and
    -- RAZORPAY_KEY_ID carries the rzp_test_ prefix, so no process holding a
    -- live key can ever reach this statement.
    -- ------------------------------------------------------------------
    if v_attempt.source_kind = 'PAYCHAOS_REPLAY'
       and v_attempt.chaos_run_id is not null then

      select cr.scenario_id into v_replay_scenario_id
      from public.chaos_runs cr
      where cr.id = v_attempt.chaos_run_id;

      if v_replay_scenario_id = 'C01' then
        select p.c01_idempotency_profile into v_c01_profile
        from public.demo_merchant_profile p
        where p.id = true;

        if v_c01_profile = 'VULNERABLE_IDEMPOTENCY' then
          v_idempotency_key := 'FULFIL_ORDER:' || v_order.id::text
            || ':ATTEMPT:' || p_processing_attempt_id::text;
        end if;
      end if;
    end if;

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
  'Phase 5 — the Phase 3C merchant processing function, plus the controlled '
  'C01 demo vulnerability required by docs/DEMO_PLAN.md Section 9. The '
  'vulnerable fulfilment idempotency key is used ONLY when all four of the '
  'following hold: the processing attempt provenance is PAYCHAOS_REPLAY, it '
  'belongs to a chaos run, that run is scenario C01, and an operator has '
  'explicitly persisted VULNERABLE_IDEMPOTENCY in demo_merchant_profile. A '
  'REAL_RAZORPAY_WEBHOOK delivery can never enter that branch, so ordinary '
  'webhook and payment processing are unchanged. No constraint is disabled: '
  'the fulfilments UNIQUE(idempotency_key) constraint remains enabled '
  'throughout. Webhook signature verification is untouched by this function.';

-- Permission surface is unchanged: still service_role execute only.
revoke all on function public.process_webhook_payment_event(uuid) from public;
revoke all on function public.process_webhook_payment_event(uuid) from anon, authenticated;
grant execute on function public.process_webhook_payment_event(uuid) to service_role;


-- ============================================================================
-- 3. reset_paychaos_demo_runtime — a reset must restore SAFE
-- ============================================================================
-- docs/DEMO_PLAN.md Section 9: a vulnerable profile "must be reset or
-- switched off after the run". Restoring the profile inside the SAME
-- transaction as the ten table deletes means a reset either fully applies
-- (data cleared AND profile SAFE) or does not apply at all. A vulnerable
-- profile surviving a reset would silently poison the next demo, so this is
-- an UPDATE, not a delete: the singleton row must continue to exist.

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
  delete from public.fulfilments where id is not null;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('fulfilments', v_deleted);

  delete from public.regression_runs where id is not null;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('regression_runs', v_deleted);

  delete from public.event_processing_attempts where id is not null;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('event_processing_attempts', v_deleted);

  delete from public.findings where id is not null;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('findings', v_deleted);

  delete from public.invariant_results where id is not null;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('invariant_results', v_deleted);

  delete from public.chaos_runs where id is not null;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('chaos_runs', v_deleted);

  delete from public.webhook_events where id is not null;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('webhook_events', v_deleted);

  delete from public.payments where id is not null;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('payments', v_deleted);

  delete from public.payment_attempts where id is not null;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('payment_attempts', v_deleted);

  delete from public.orders where id is not null;
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('orders', v_deleted);

  -- Restore the controlled test behaviour to SAFE. Deliberately last, and
  -- deliberately an UPDATE: the singleton row must survive so the profile is
  -- never absent. `is distinct from` keeps the write a no-op when the profile
  -- is already SAFE, which is the common case.
  update public.demo_merchant_profile
  set c01_idempotency_profile = 'SAFE',
      updated_at = now()
  where id = true
    and c01_idempotency_profile is distinct from 'SAFE';
  get diagnostics v_deleted = row_count;
  v_counts := v_counts || jsonb_build_object('demo_merchant_profile_reset_to_safe', v_deleted);

  return v_counts;
end;
$$;

comment on function public.reset_paychaos_demo_runtime() is
  'Phase 5 — the documented administrative Demo Reset. Deletes exactly the '
  'ten approved runtime tables in verified child-before-parent order inside '
  'ONE transaction, then restores demo_merchant_profile to SAFE in that '
  'same transaction, so a reset either fully applies or does not apply at '
  'all and a controlled vulnerable profile can never survive it. Every '
  'DELETE carries an explicit primary-key predicate so the statement '
  'satisfies Supabase safeupdate, which refuses an unqualified DELETE in '
  'the API role context; that protection remains enabled and is never '
  'disabled by this function. Takes no arguments: no table name, predicate '
  'or SQL text can be supplied by a caller. Never uses CASCADE or TRUNCATE. '
  'Touches no schema, migration, RLS policy, auth, storage or configuration.';

revoke all on function public.reset_paychaos_demo_runtime() from public;
revoke all on function public.reset_paychaos_demo_runtime() from anon, authenticated;
grant execute on function public.reset_paychaos_demo_runtime() to service_role;
