-- PayChaos AI — Phase 2C additive migration.
--
-- Creates the canonical `public.payments` table per docs/DATABASE.md
-- Section 11 — the first sub-phase where a Razorpay Payment identity is
-- observed. `payments` is separate from `payment_attempts` (which owns the
-- server-created Razorpay Order correlation) and separate from `orders`
-- (which owns Demo Merchant business state) — see docs/DATABASE.md Section
-- 6 relationship chain and Section 34 ownership boundaries.
--
-- This migration does NOT edit, rewrite, or squash the approved Phase 1 or
-- Phase 2B migrations — it is purely additive, per docs/DATABASE.md Section
-- 44 "Migration Ownership by Phase".
--
-- This migration does NOT create `webhook_events` or
-- `event_processing_attempts` — those remain Phase 2D/2E work, not part of
-- this Phase 2C Checkout-integration slice. It also does NOT add
-- `fulfilments.payment_id` — that column is deferred to the Phase that
-- actually links fulfilment to verified payment evidence, per
-- docs/DATABASE.md's existing "Column Phasing Note" on `fulfilments`.
--
-- This migration contains no secrets. It only defines schema, constraints,
-- indexes, RLS and narrow privilege grants.
--
-- NOT APPLIED YET: this file is prepared for later manual/developer-driven
-- application against the real Supabase project, using the same protocol
-- already used for the Phase 1 and Phase 2B migrations.

-- ============================================================================
-- TABLE: payments  (docs/DATABASE.md Section 11)
-- ============================================================================

create table public.payments (
  id uuid primary key default gen_random_uuid(),

  payment_attempt_id uuid not null references public.payment_attempts (id) on delete restrict,

  razorpay_payment_id text not null,
  razorpay_payment_status text,

  amount_subunits bigint not null,
  currency varchar(3) not null default 'INR',

  checkout_signature_verified boolean not null default false,
  checkout_verified_at timestamptz,

  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),

  captured_at timestamptz,
  failed_at timestamptz,

  error_code text,
  error_description_redacted text,
  error_source text,
  error_step text,
  error_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payments_amount_subunits_positive check (amount_subunits > 0),
  constraint payments_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint payments_razorpay_payment_id_unique unique (razorpay_payment_id),
  constraint payments_checkout_verified_at_consistency check (
    checkout_signature_verified = false or checkout_verified_at is not null
  )
);

comment on table public.payments is
  'Phase 2C — canonical Razorpay Test Mode Payment evidence, separate from '
  'payment_attempts (Razorpay Order correlation) and orders (merchant '
  'business state). checkout_signature_verified/checkout_verified_at '
  'record only that a Checkout response was authenticated — they do NOT '
  'establish captured-state truth (docs/MONEY_INVARIANTS.md Section 5). '
  'See docs/DATABASE.md Section 11.';

comment on column public.payments.razorpay_payment_status is
  'Plain text, external Razorpay status — intentionally NOT a Postgres '
  'enum (docs/DATABASE.md Section 8.6). NULL in Phase 2C: no separate '
  'verified provider status evidence exists yet (webhook processing is '
  'Phase 2D).';

comment on column public.payments.checkout_signature_verified is
  'True only after this server has independently verified the Checkout '
  'HMAC signature using the TRUSTED payment_attempts.razorpay_order_id '
  '(never a browser-supplied order id). Does not imply captured/paid.';

comment on column public.payments.captured_at is
  'NULL in Phase 2C. A verified Checkout signature authenticates the '
  'response; it does not authorize marking the payment captured. Set only '
  'by later phases with authoritative captured-payment evidence.';

comment on column public.payments.failed_at is
  'NULL in Phase 2C. No provider failure evidence is established from a '
  'Checkout signature verification path.';

-- Required indexes — docs/DATABASE.md Section 11 "Indexes" / Section 42.
-- (razorpay_payment_id unique constraint above already creates its own
-- index.)
create index payments_payment_attempt_id_idx on public.payments (payment_attempt_id);
create index payments_razorpay_payment_status_idx on public.payments (razorpay_payment_status);
create index payments_created_at_idx on public.payments (created_at);

-- ============================================================================
-- ROW LEVEL SECURITY AND PRIVILEGES  (docs/DATABASE.md Section 40,
-- docs/SECURITY.md Section 25)
--
-- Same explicit, source-controlled access model already used by the Phase 1
-- and Phase 2B migrations: RLS enabled with zero policies (denies all
-- access to anon/authenticated by default), privileges additionally
-- REVOKEd explicitly rather than relying on the absence of a GRANT alone,
-- and narrow explicit CRUD GRANTs to `service_role` only (the trusted
-- Next.js server credential, which also carries BYPASSRLS but still needs
-- an ordinary table-level GRANT to touch the table at all).
-- ============================================================================

alter table public.payments enable row level security;

revoke all privileges on table public.payments from anon, authenticated;

grant select, insert, update, delete on public.payments to service_role;
