-- PayChaos AI — Phase 2F additive migration.
--
-- Adds the two Phase-2-owned `fulfilments` columns docs/DATABASE.md Section
-- 12 already documents as part of the complete, final `fulfilments` schema
-- but which neither the Phase 1 migration
-- (20260823000000_phase1_foundation_schema.sql) nor any earlier Phase 2
-- migration created — see that table's own "Column Phasing Note" and
-- "Phase Ownership" sections. Both columns are added here, once their
-- referenced tables (`payments`, `event_processing_attempts`) already exist
-- from the Phase 2C/2E migrations.
--
-- Also adds the single narrow PostgreSQL transaction boundary
-- (`process_webhook_payment_event`) that applies authoritative merchant/
-- payment state from a durably normalized, correlated
-- `event_processing_attempts` row — this task's Section 3 "one database
-- transaction" requirement. This is the first migration allowed to apply
-- authoritative money/business state; no earlier Phase 2 migration does.
--
-- This migration does NOT edit, rewrite, or squash the approved Phase 1,
-- Phase 2B, Phase 2C, Phase 2D, or Phase 2E migrations — it is purely
-- additive, per docs/DATABASE.md Section 44 "Migration Ownership by Phase".
--
-- This migration does NOT create `chaos_runs`, `invariant_results`,
-- `findings`, or `regression_runs`, and does NOT add any Phase 3-only
-- column (`chaos_run_id`/`fault_action`/`state_before`/`state_after` on
-- `event_processing_attempts`) — those remain later-phase work per
-- docs/DATABASE.md Section 14 "Phase Ownership".
--
-- This migration contains no secrets. It only defines schema, constraints,
-- indexes, a narrowly-scoped transactional SQL function, RLS and narrow
-- privilege grants.
--
-- NOT APPLIED YET: this file is prepared for later manual/developer-driven
-- application against the real Supabase project, using the same protocol
-- already used for the Phase 1, Phase 2B, Phase 2C, Phase 2D, and Phase 2E
-- migrations, and only after architect review of this Phase 2F candidate.
--
-- ============================================================================
-- 2026-08-29 ARCHITECT REVIEW CORRECTION — this file was revised after an
-- explicit architect rejection of the first Phase 2F candidate. Four
-- findings were corrected inside `process_webhook_payment_event` below (the
-- `fulfilments` additive columns above are UNCHANGED from the first
-- candidate — the architect raised no finding against them):
--
--   Finding A (concurrency): the function now locks EVERY shared mutable
--   correlated row — event_processing_attempts, webhook_events,
--   payment_attempts, orders, and (when applicable) payments — with
--   `SELECT ... FOR UPDATE`, always in that fixed order. `payment.failed`'s
--   "is this payment already captured?" decision is now computed strictly
--   AFTER locking and re-reading the payment row, so a concurrent
--   `payment.captured` transaction against the SAME payment can never be
--   invisibly overwritten by a racing `payment.failed` transaction — the
--   two calls serialize on the payment row lock instead.
--
--   Finding B (fail-closed event contract): the function no longer falls
--   into `order.paid` handling via a catch-all ELSE. It now explicitly
--   validates the full normalized-event envelope
--   (`sourceKind`/`eventType`/`kind`, `kind = eventType`, both values drawn
--   from exactly the three supported P0 event types) before ANY merchant
--   mutation, and uses explicit `IF ... ELSIF ... ELSIF ... ELSE FAIL`
--   branches for `payment.captured` / `payment.failed` / `order.paid`. It
--   also now cross-checks the canonical `webhook_events` row's own columns
--   (`source_kind`, `signature_verified`, `event_type`,
--   `razorpay_order_id`, `razorpay_payment_id`, `payment_attempt_id`,
--   `payment_id`, `amount_subunits`, `currency`, `razorpay_payment_status`)
--   against the normalized event and the processing attempt's own
--   correlation, failing closed (raising `PROCESSING_CORRELATION_INVALID`
--   or the new `PROCESSING_EVENT_INVALID`) on any disagreement. Every field
--   name this cross-check needed already exists as a literal
--   `webhook_events` column from the Phase 2D/2E migrations, and every
--   `sourceKind`/`eventType`/`kind` field already exists as a literal key
--   in `event_processing_attempts.normalized_event`
--   (`lib/events/normalization.ts`) — no invented column/field name was
--   needed anywhere in this correction.
--
--   Finding C (PROCESSING recovery): a durably-persisted `PROCESSING`
--   attempt is no longer rejected — it is now processed through the exact
--   same idempotent logic as `PENDING` (the function's business-effect
--   idempotency — the conditional guarded UPDATEs and the fulfilment
--   `ON CONFLICT` — already made this safe to allow). `HELD`/`FAILED`/
--   `SKIPPED_DUPLICATE` remain rejected as not-ready/non-authoritative.
--
--   Finding D (fulfilment conflict): the existing fulfilment idempotency
--   conflict check now also compares `effect_type`, not only
--   `order_id`/`payment_id` — an existing fulfilment row under the same
--   idempotency key must agree on `effect_type = 'FULFIL_ORDER'` too, or
--   the call fails closed with `PROCESSING_FULFILMENT_CONFLICT`.
--
-- No table/column/index/RLS/grant statement anywhere in this file changed
-- as part of this correction — only the body of
-- `process_webhook_payment_event` and its RAISE EXCEPTION codes did.
-- ============================================================================

-- ============================================================================
-- fulfilments — additive columns (docs/DATABASE.md Section 12)
--
-- The database is manually verified to contain zero fulfilment rows at this
-- point (Phase 1 never inserts into fulfilments; Phase 2A-2E never do
-- either — merchant/business-state application starts here), so adding a
-- NOT NULL payment_id column is safe without a backfill.
-- ============================================================================

alter table public.fulfilments
  add column payment_id uuid references public.payments (id) on delete restrict,
  add column trigger_processing_attempt_id uuid references public.event_processing_attempts (id) on delete restrict;

-- The FK is added nullable first (a single ALTER TABLE ADD COLUMN ...
-- REFERENCES ... NOT NULL in one statement is also safe on an empty table,
-- but doing the NOT NULL as a separate explicit statement keeps the
-- "docs/DATABASE.md requires NOT NULL" requirement visibly traceable to its
-- own statement rather than buried in a compound column definition).
alter table public.fulfilments
  alter column payment_id set not null;

comment on column public.fulfilments.payment_id is
  'Phase 2F — the payments row that authorized this fulfilment. NOT NULL: '
  'every fulfilment row must trace to one specific authorizing captured '
  'payment (docs/DATABASE.md Section 12, INV-010).';

comment on column public.fulfilments.trigger_processing_attempt_id is
  'Phase 2F — the event_processing_attempts row whose successful merchant '
  'processing created (or first resolved) this fulfilment. Nullable in the '
  'general schema (docs/DATABASE.md), but always populated by the Phase 2F '
  'process_webhook_payment_event() transaction for every row it creates.';

-- Required indexes — docs/DATABASE.md Section 12 "Indexes" (the two that
-- arrive with these columns, not part of the Phase 1 migration).
create index fulfilments_payment_id_idx on public.fulfilments (payment_id);
create index fulfilments_trigger_processing_attempt_id_idx on public.fulfilments (trigger_processing_attempt_id);

-- UNIQUE(idempotency_key) already exists from the Phase 1 migration and is
-- untouched by this migration (docs/DATABASE.md Section 12 "Idempotency
-- Model" — the business-effect race boundary this task's Section 19
-- requires).

-- RLS/privileges on fulfilments were already established by the Phase 1
-- migration (RLS enabled, zero policies, anon/authenticated revoked,
-- service_role explicit CRUD grant) and are unaffected by adding columns to
-- an existing table — no RLS/GRANT/REVOKE statement is needed or added here
-- for fulfilments (same reasoning as the Phase 2B
-- payment_attempts.razorpay_order_id addition).

-- ============================================================================
-- FUNCTION: process_webhook_payment_event  (this task's Sections 3-21;
-- 2026-08-29 architect review correction Findings A-D above)
--
-- The single narrow PostgreSQL transaction that applies authoritative
-- merchant/payment state from one durably normalized, correlated
-- `event_processing_attempts` row. One function invocation is one
-- transaction — there is no separate JS-orchestrated sequence of
-- UPDATE/INSERT calls that could commit partially.
--
-- `language plpgsql` (required for row locking + control flow — the
-- Phase 2E `record_webhook_duplicate_delivery` RPC could stay `language
-- sql` because it was one statement; this one cannot). `security invoker`
-- (not `definer`): the only caller is the trusted `service_role`
-- credential, which already holds the required table privileges from every
-- earlier migration, so no privilege elevation is needed and no
-- `search_path`-hijack surface exists for a definer context. `search_path`
-- is still pinned explicitly as defense-in-depth. No dynamic SQL anywhere in
-- this function body. The only caller input is `p_processing_attempt_id` —
-- an internal PayChaos UUID, never a browser-supplied order/payment id,
-- amount, currency, status, or fulfilment key (this task's Section 4).
--
-- Every fact this function acts on (webhook event, payment attempt,
-- payment, order, normalized event) is loaded from trusted database rows —
-- never re-derived from a fresh HTTP request body (this task's Section 7).
--
-- LOCK ORDER (Finding A, fixed and always identical across every call):
--   1. event_processing_attempts (the target attempt)
--   2. webhook_events            (the correlated canonical event)
--   3. payment_attempts          (the correlated internal attempt)
--   4. orders                    (the correlated internal order)
--   5. payments                  (the correlated canonical payment, only
--                                 when the event kind requires/permits one)
-- Two calls racing over the SAME set of correlated rows always acquire
-- these locks in this same order, so they serialize rather than deadlock,
-- and neither can observe the other's partially-applied state.
--
-- Deterministic safe failure codes (this task's Section 27) are raised as
-- `RAISE EXCEPTION '<CODE>: <safe detail>'` — the calling TypeScript layer
-- (lib/webhooks/event-processing-repository.ts's
-- `processWebhookPaymentEvent`) parses only the leading `<CODE>:` token and
-- never forwards the raw Postgres error text through the HTTP response.
-- ============================================================================

create function public.process_webhook_payment_event(
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
  -- may be processed (this task's Section 8) — this is the serialization
  -- boundary for two callers racing on the SAME processing attempt id.
  select * into v_attempt
  from public.event_processing_attempts
  where id = p_processing_attempt_id
  for update;

  if not found then
    raise exception 'PROCESSING_ATTEMPT_NOT_FOUND: processing attempt % does not exist', p_processing_attempt_id;
  end if;

  if v_attempt.status = 'SUCCEEDED' then
    -- Idempotent success (this task's Section 8/26): derive and return the
    -- prior result WITHOUT any mutation. A caller retrying an
    -- already-succeeded attempt (e.g. a duplicate-delivery redelivery
    -- routed back through the same attempt id) must be a safe no-op. No
    -- further locks are taken on this path — nothing is mutated.
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

  -- Finding C (PROCESSING recovery): PENDING and PROCESSING are BOTH safe
  -- to (re)process here through the exact same idempotent logic below —
  -- a durably-persisted PROCESSING row (e.g. left behind by a caller that
  -- crashed after this function committed a PROCESSING mark in some future
  -- multi-statement variant, or constructed directly for recovery testing)
  -- must be recoverable, not permanently stuck. HELD/FAILED/SKIPPED_DUPLICATE
  -- remain rejected: HELD is not normally produced in Phase 2 and must
  -- never be falsely acknowledged as successful; FAILED must not be
  -- silently reprocessed by this same historical attempt (a retry must go
  -- through a new PENDING attempt via the normal webhook flow);
  -- SKIPPED_DUPLICATE must never be treated as authoritative.
  if v_attempt.status not in ('PENDING', 'PROCESSING') then
    raise exception 'PROCESSING_ATTEMPT_NOT_READY: processing attempt % has status % and cannot be processed', p_processing_attempt_id, v_attempt.status;
  end if;

  if v_attempt.source_kind <> 'REAL_RAZORPAY_WEBHOOK' or v_attempt.webhook_event_id is null then
    raise exception 'PROCESSING_SOURCE_INVALID: processing attempt % does not carry valid REAL_RAZORPAY_WEBHOOK evidence', p_processing_attempt_id;
  end if;

  -- Conceptually PENDING/PROCESSING -> PROCESSING -> SUCCEEDED within one
  -- transaction (this task's Section 9; a harmless self-assignment when
  -- already PROCESSING). This write only survives if the whole function
  -- later returns normally; any RAISE EXCEPTION below rolls it back along
  -- with every other mutation in this function invocation.
  update public.event_processing_attempts
  set status = 'PROCESSING'
  where id = p_processing_attempt_id;

  -- Fail-closed envelope validation (Finding B) — BEFORE any further lock
  -- or mutation. `normalized_event` is guaranteed to be a JSON object by
  -- the table's own `event_processing_attempts_normalized_event_is_object`
  -- CHECK constraint, but this is re-asserted here as defense-in-depth
  -- rather than relying on that constraint alone.
  v_normalized := v_attempt.normalized_event;

  if jsonb_typeof(v_normalized) <> 'object' then
    raise exception 'PROCESSING_EVENT_INVALID: normalized event is not a JSON object for attempt %', p_processing_attempt_id;
  end if;

  v_norm_source_kind := v_normalized->>'sourceKind';
  v_norm_event_type := v_normalized->>'eventType';
  v_kind := v_normalized->>'kind';

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
  -- defense-in-depth (Finding B: "webhook.id = processing_attempt.webhook_event_id").
  if v_webhook.id <> v_attempt.webhook_event_id then
    raise exception 'PROCESSING_CORRELATION_INVALID: webhook event identity mismatch for attempt %', p_processing_attempt_id;
  end if;

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

  -- Explicit branches only (Finding B): payment.captured / payment.failed /
  -- order.paid are each handled by name. The final ELSE is unreachable
  -- given the envelope validation above, but is kept as an explicit
  -- fail-closed branch rather than ever treating an unrecognized kind as
  -- order.paid authority.
  if v_kind = 'payment.captured' then
    if v_attempt.payment_id is null then
      raise exception 'PROCESSING_PAYMENT_REQUIRED: processing attempt % has no correlated payment', p_processing_attempt_id;
    end if;

    -- 5. Lock the payment row (same lock order as payment.failed below —
    -- Finding A — so two concurrent captured/failed calls against the SAME
    -- payment always serialize here).
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

    -- This task's Section 12/13: apply captured state, never regress PAID,
    -- capture converges even after a prior failure observation.
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

    -- Business-effect idempotency (this task's Sections 6/18/19): derive
    -- the stable semantic key from the order id alone (never the
    -- processing-attempt/event id), and use an INSERT ... ON CONFLICT DO
    -- UPDATE (a harmless self-assignment) rather than a
    -- SELECT-then-INSERT, so a genuinely concurrent second transaction
    -- attempting the same idempotency_key blocks on the row lock and
    -- observes the FIRST transaction's committed row afterward, rather
    -- than racing past a plain SELECT that hasn't seen an uncommitted
    -- insert yet.
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
      -- disagrees on order/payment/effect-type identity (Finding D) — fail
      -- closed rather than silently accept a conflicting row (this task's
      -- Section 18).
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
    -- happened (Finding A — the critical concurrency fix). This is the
    -- exact serialization boundary that makes capture-vs-failure races
    -- safe: whichever transaction (this payment.failed call, or a
    -- concurrent payment.captured call locking the SAME payment row above)
    -- acquires this lock first commits its decision and releases the lock
    -- on COMMIT; the second transaction blocks here until the first
    -- commits, then its own `SELECT ... FOR UPDATE` always observes the
    -- latest COMMITTED row — never a stale pre-lock snapshot — so
    -- `v_already_captured` below is always computed from up-to-date state.
    -- A payment.failed transaction can therefore never overwrite a
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

    -- This task's Section 14/15: failure observation never fulfils; a
    -- stale failure arriving after authoritative capture must not regress
    -- captured/PAID/FULFILLED state. v_payment was locked above BEFORE
    -- this decision (Finding A) — never computed from a pre-lock read.
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
    -- retained over stronger capture evidence (this task's Section 15).

  elsif v_kind = 'order.paid' then
    -- order.paid: corroborating evidence only. Never creates a payments
    -- row, never sets captured state, never fulfils (this task's Section
    -- 16).
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
      -- attempt (Finding B) rather than trusting it uncorrelated.
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
    -- unrecognized/corrupted kind as order.paid authority (Finding B).
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
  'Phase 2F (2026-08-29 architect review correction) — the single narrow '
  'transaction that applies authoritative merchant/payment state from one '
  'durably normalized, correlated event_processing_attempts row. One '
  'invocation is one transaction: either every protected mutation '
  '(payments/payment_attempts/orders/fulfilments/event_processing_attempts/'
  'webhook_events) commits together, or none of them do. Locks every '
  'shared mutable correlated row (event_processing_attempts -> '
  'webhook_events -> payment_attempts -> orders -> payments) with '
  'SELECT ... FOR UPDATE in this fixed order before mutating, so '
  'concurrent payment.captured/payment.failed calls against the SAME '
  'payment always serialize rather than race. Validates the full '
  'normalized-event envelope and cross-checks it against the canonical '
  'webhook_events row before any mutation, using explicit '
  'payment.captured/payment.failed/order.paid branches with a fail-closed '
  'ELSE — never a catch-all order.paid fallback. Never accepts '
  'browser-supplied order/payment/amount/currency/status/fulfilment-key '
  'values — only an internal processing attempt id; every fact is loaded '
  'from trusted, locked rows.';

-- Postgres grants EXECUTE on newly created functions to PUBLIC by default —
-- explicitly revoke that, then grant only to service_role (this task's
-- Section 4). Neither anon nor authenticated may ever call this function.
revoke all on function public.process_webhook_payment_event(uuid) from public;
grant execute on function public.process_webhook_payment_event(uuid) to service_role;
