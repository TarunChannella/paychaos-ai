-- PayChaos AI — Phase 1C-A foundation schema.
--
-- Creates exactly the three Phase 1-owned tables approved in
-- docs/DATABASE.md Sections 9, 10, 12 and docs/PHASE_PLAN.md Section 5.11:
--   - orders
--   - payment_attempts
--   - fulfilments
--
-- This migration must NOT create `payments`, `webhook_events`,
-- `event_processing_attempts`, `chaos_runs`, `invariant_results`,
-- `findings`, or `regression_runs` — those belong to later phases
-- (docs/DATABASE.md Section 44).
--
-- IMMUTABILITY NOTE (docs/DATABASE.md — `fulfilments` "Column Phasing
-- Note" and commit ac8206d "docs: resolve Phase 1 fulfilment schema
-- dependency"): once this Phase 1 migration is approved, it must never be
-- rewritten to add `fulfilments.payment_id` or
-- `fulfilments.trigger_processing_attempt_id`. Those columns are added by
-- new, additive Phase 2 migration files once `payments` and
-- `event_processing_attempts` exist. Phase 1 must not insert any row into
-- `fulfilments` — no authoritative payment evidence exists yet.
--
-- This migration contains no secrets. It only defines schema, constraints,
-- indexes, RLS and narrow privilege grants.
--
-- NOT APPLIED YET: this file is prepared for later manual/developer-driven
-- application against the real Supabase project. It has not been run
-- against any remote database as part of producing this file.

-- ============================================================================
-- TABLE: orders  (docs/DATABASE.md Section 9)
-- ============================================================================

create table public.orders (
  id uuid primary key default gen_random_uuid(),

  amount_subunits bigint not null,
  currency varchar(3) not null default 'INR',

  payment_status text not null default 'UNPAID',
  business_status text not null default 'OPEN',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint orders_amount_subunits_positive check (amount_subunits > 0),
  constraint orders_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint orders_payment_status_valid check (
    payment_status in ('UNPAID', 'PENDING', 'FAILED_OBSERVED', 'PAID')
  ),
  constraint orders_business_status_valid check (
    business_status in ('OPEN', 'FULFILLED')
  )
);

comment on table public.orders is
  'Phase 1 — Demo Merchant internal business order. Not a Razorpay Order. '
  'See docs/DATABASE.md Section 9.';

-- Required indexes (PK already indexes id) — docs/DATABASE.md Section 9
-- "Indexes" / Section 42.
create index orders_created_at_idx on public.orders (created_at);
create index orders_payment_status_idx on public.orders (payment_status);
create index orders_business_status_idx on public.orders (business_status);

-- ============================================================================
-- TABLE: payment_attempts  (docs/DATABASE.md Section 10, Phase 1 subset)
--
-- Phase 1 creates only the foundational columns: id, order relation,
-- attempt number, amount, currency, basic status, stable receipt.
-- `razorpay_order_id` / `razorpay_order_status` are explicitly Phase 2
-- additive columns and are NOT created here.
-- ============================================================================

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),

  order_id uuid not null references public.orders (id) on delete restrict,

  attempt_no smallint not null,
  amount_subunits bigint not null,
  currency varchar(3) not null default 'INR',

  status text not null default 'CREATED',
  razorpay_receipt text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payment_attempts_attempt_no_positive check (attempt_no > 0),
  constraint payment_attempts_amount_subunits_positive check (amount_subunits > 0),
  constraint payment_attempts_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint payment_attempts_status_valid check (
    status in (
      'CREATED',
      'ORDER_CREATED',
      'CHECKOUT_IN_PROGRESS',
      'FAILED_OBSERVED',
      'CAPTURED'
    )
  ),
  constraint payment_attempts_order_id_attempt_no_unique unique (order_id, attempt_no),
  constraint payment_attempts_razorpay_receipt_unique unique (razorpay_receipt)
);

comment on table public.payment_attempts is
  'Phase 1 — one PayChaos attempt to pay a Demo Merchant order. Phase 2 '
  'adds razorpay_order_id/razorpay_order_status via an additive migration. '
  'See docs/DATABASE.md Section 10.';

-- Required indexes — docs/DATABASE.md Section 10 "Indexes" / Section 42.
-- (order_id, attempt_no) and (razorpay_receipt) unique constraints above
-- already create their own indexes.
create index payment_attempts_order_id_idx on public.payment_attempts (order_id);
create index payment_attempts_status_idx on public.payment_attempts (status);
create index payment_attempts_created_at_idx on public.payment_attempts (created_at);

-- ============================================================================
-- TABLE: fulfilments  (docs/DATABASE.md Section 12, Phase 1 subset)
--
-- Phase 1 creates the business-effect representation WITHOUT `payment_id`
-- and WITHOUT `trigger_processing_attempt_id` — those are Phase 2 additive
-- columns per the approved resolution in commit ac8206d. Phase 1 must not
-- insert any row into this table.
-- ============================================================================

create table public.fulfilments (
  id uuid primary key default gen_random_uuid(),

  order_id uuid not null references public.orders (id) on delete restrict,

  effect_type text not null default 'FULFIL_ORDER',
  idempotency_key text not null,

  applied_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint fulfilments_effect_type_valid check (effect_type = 'FULFIL_ORDER'),
  constraint fulfilments_idempotency_key_unique unique (idempotency_key)
);

comment on table public.fulfilments is
  'Phase 1 — Demo Merchant business-effect record, created WITHOUT '
  'payment_id/trigger_processing_attempt_id (added by Phase 2 additive '
  'migrations). Empty until Phase 2 — Phase 1 has no authoritative payment '
  'evidence to fulfil against. See docs/DATABASE.md Section 12.';

-- Required indexes — docs/DATABASE.md Section 12 "Indexes" / Section 42.
-- (idempotency_key unique constraint above already creates its own index;
-- the payment_id / trigger_processing_attempt_id indexes arrive with their
-- columns in Phase 2, not part of this migration.)
create index fulfilments_order_id_idx on public.fulfilments (order_id);
create index fulfilments_applied_at_idx on public.fulfilments (applied_at);

-- ============================================================================
-- ROW LEVEL SECURITY AND PRIVILEGES  (docs/DATABASE.md Section 40,
-- docs/SECURITY.md Section 25)
--
-- This project has Enable Data API = ON, Automatic RLS = ON, and
-- "Automatically expose new tables" = OFF. Rather than relying on those
-- dashboard defaults alone to keep `anon`/`authenticated` out, the access
-- model below is made fully explicit and source-controlled:
--
--   1. RLS is enabled on all three tables with zero policies defined. In
--      PostgreSQL, enabling RLS with no policies denies ALL access
--      (SELECT, INSERT, UPDATE, DELETE) to every role that is not the
--      table owner and does not have the BYPASSRLS attribute.
--   2. Table-level privileges for `anon` and `authenticated` are also
--      explicitly REVOKEd on each table, so access is denied by an
--      explicit statement in this migration rather than only by the
--      absence of a GRANT. No permissive policy is created "to make
--      testing easier" (explicitly forbidden by this task), and no P0
--      requirement in docs/DATABASE.md or docs/SECURITY.md authorizes any
--      anon/authenticated access to these tables in Phase 1.
--   3. `service_role` has the BYPASSRLS attribute, so RLS policies never
--      restrict it — but BYPASSRLS only skips row-security filtering, not
--      the separate PostgreSQL GRANT system. A role still needs an
--      ordinary table-level GRANT to touch a table at all, so
--      service_role is given explicit, narrow SELECT/INSERT/UPDATE/DELETE
--      grants on exactly these three tables — nothing broader (no
--      schema-wide grant) — so the trusted Next.js server can perform
--      authoritative Phase 1 writes/reads once this migration is applied.
--
-- Final per-table model: anon/authenticated have privileges explicitly
-- revoked, RLS enabled, and zero policies (all access denied);
-- service_role has explicit CRUD grants (server-only credential).
-- ============================================================================

alter table public.orders enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.fulfilments enable row level security;

revoke all privileges on table public.orders from anon, authenticated;
revoke all privileges on table public.payment_attempts from anon, authenticated;
revoke all privileges on table public.fulfilments from anon, authenticated;

grant select, insert, update, delete on public.orders to service_role;
grant select, insert, update, delete on public.payment_attempts to service_role;
grant select, insert, update, delete on public.fulfilments to service_role;
