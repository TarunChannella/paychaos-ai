-- PayChaos AI — Phase 2D additive migration.
--
-- Creates the canonical `public.webhook_events` table per docs/DATABASE.md
-- Section 13 — the first sub-phase where genuine external Razorpay
-- webhook evidence is captured. Separate from `payment_attempts` (Razorpay
-- Order correlation) and `payments` (canonical Razorpay Payment evidence)
-- — see docs/DATABASE.md Section 6 relationship chain.
--
-- This migration does NOT edit, rewrite, or squash the approved Phase 1,
-- Phase 2B, or Phase 2C migrations — it is purely additive, per
-- docs/DATABASE.md Section 44 "Migration Ownership by Phase".
--
-- This migration does NOT create `event_processing_attempts`,
-- `chaos_runs`, `invariant_results`, `findings`, or `regression_runs` —
-- those remain later-phase work, not part of this Phase 2D webhook-
-- ingestion slice. It also does NOT implement the complete Phase 2E
-- duplicate-delivery workflow — `UNIQUE(razorpay_event_id)` is foundational
-- schema integrity; `duplicate_delivery_count` increment behavior is
-- explicitly deferred to Phase 2E (docs/DATABASE.md Section 13 Phase
-- Ownership: "Phase 3 [renumbered: later phase] Adds/uses... chaos_run_id;
-- replay/simulation source kinds").
--
-- This migration contains no secrets. It only defines schema, constraints,
-- indexes, RLS and narrow privilege grants.
--
-- NOT APPLIED YET: this file is prepared for later manual/developer-driven
-- application against the real Supabase project, using the same protocol
-- already used for the Phase 1, Phase 2B, and Phase 2C migrations.

-- ============================================================================
-- TABLE: webhook_events  (docs/DATABASE.md Section 13)
-- ============================================================================

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),

  razorpay_event_id text not null,
  event_type text not null,

  source_kind text not null default 'REAL_RAZORPAY_WEBHOOK',

  razorpay_order_id text,
  razorpay_payment_id text,

  payment_attempt_id uuid references public.payment_attempts (id) on delete restrict,
  payment_id uuid references public.payments (id) on delete restrict,

  signature_verified boolean not null,

  received_at timestamptz not null default now(),
  provider_created_at timestamptz,

  amount_subunits bigint,
  currency varchar(3),
  razorpay_payment_status text,

  raw_body_sha256 char(64) not null,
  raw_payload_redacted jsonb not null default '{}',

  processing_status text not null default 'RECEIVED',
  processed_at timestamptz,
  duplicate_delivery_count integer not null default 0,

  updated_at timestamptz not null default now(),

  constraint webhook_events_razorpay_event_id_unique unique (razorpay_event_id),
  constraint webhook_events_source_kind_valid check (
    source_kind = 'REAL_RAZORPAY_WEBHOOK'
  ),
  constraint webhook_events_signature_verified_true check (
    signature_verified = true
  ),
  constraint webhook_events_amount_subunits_positive check (
    amount_subunits is null or amount_subunits > 0
  ),
  constraint webhook_events_currency_format check (
    currency is null or currency ~ '^[A-Z]{3}$'
  ),
  constraint webhook_events_raw_body_sha256_shape check (
    raw_body_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint webhook_events_raw_payload_redacted_is_object check (
    jsonb_typeof(raw_payload_redacted) = 'object'
  ),
  constraint webhook_events_processing_status_valid check (
    processing_status in ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED')
  ),
  constraint webhook_events_duplicate_delivery_count_non_negative check (
    duplicate_delivery_count >= 0
  )
);

comment on table public.webhook_events is
  'Phase 2D — canonical, signature-verified Razorpay Test Mode webhook '
  'evidence. Every row is a real, HMAC-authenticated delivery '
  '(signature_verified is CHECK-constrained to true; source_kind is '
  'CHECK-constrained to REAL_RAZORPAY_WEBHOOK — a PayChaos replay never '
  'inserts here). Normalization/correlation columns '
  '(razorpay_order_id/razorpay_payment_id/payment_attempt_id/payment_id/'
  'amount_subunits/currency/razorpay_payment_status) remain NULL until '
  'Phase 2E event normalization runs. See docs/DATABASE.md Section 13.';

comment on column public.webhook_events.raw_body_sha256 is
  'SHA-256 (lowercase hex) of the EXACT raw request bytes used for HMAC '
  'verification — never of the redacted evidence or a re-serialized '
  'payload. Evidence-integrity hash; the full raw body is not retained.';

comment on column public.webhook_events.raw_payload_redacted is
  'Allowlist-projected safe evidence only (lib/webhooks/redaction.ts) — '
  'never email/contact/VPA/card/bank/notes/tokens/signature, regardless '
  'of what the real payload contains.';

comment on column public.webhook_events.duplicate_delivery_count is
  'Always 0 as inserted by Phase 2D. Increment behavior on a real '
  'redelivery is explicitly Phase 2E scope — this column exists now only '
  'as foundational schema, per docs/DATABASE.md Section 13.';

-- Required indexes — docs/DATABASE.md Section 13 "Indexes" / Section 42.
-- (razorpay_event_id unique constraint above already creates its own
-- index.)
create index webhook_events_payment_attempt_id_idx on public.webhook_events (payment_attempt_id);
create index webhook_events_payment_id_idx on public.webhook_events (payment_id);
create index webhook_events_razorpay_order_id_idx on public.webhook_events (razorpay_order_id);
create index webhook_events_razorpay_payment_id_idx on public.webhook_events (razorpay_payment_id);
create index webhook_events_event_type_received_at_idx on public.webhook_events (event_type, received_at);
create index webhook_events_processing_status_idx on public.webhook_events (processing_status);

-- ============================================================================
-- ROW LEVEL SECURITY AND PRIVILEGES  (docs/DATABASE.md Section 40,
-- docs/SECURITY.md Section 25)
--
-- Same explicit, source-controlled access model already used by the Phase
-- 1, Phase 2B, and Phase 2C migrations: RLS enabled with zero policies
-- (denies all access to anon/authenticated by default), privileges
-- additionally REVOKEd explicitly rather than relying on the absence of a
-- GRANT alone, and narrow explicit CRUD GRANTs to `service_role` only (the
-- trusted Next.js server credential — the public webhook route writes
-- through this credential only AFTER signature verification succeeds).
-- ============================================================================

alter table public.webhook_events enable row level security;

revoke all privileges on table public.webhook_events from anon, authenticated;

grant select, insert, update, delete on public.webhook_events to service_role;
