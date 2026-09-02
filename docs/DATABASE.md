# PayChaos AI — Database Design

**Project:** PayChaos AI — Autonomous Payment Reliability Engineer  
**Database:** Supabase PostgreSQL  
**Design Status:** Source-of-truth database specification  
**Scope:** Complete P0 schema + explicitly approved P1 extension  
**Runtime Cost Target:** ₹0  
**Environment:** Controlled Demo Merchant + Razorpay Test Mode only

---

# 0. Purpose and Authority of This Document

This document defines the complete PayChaos AI database contract.

It tells future implementation sessions:

- which tables exist;
- which tables do not exist;
- exact column responsibilities;
- relationships;
- constraints;
- idempotency boundaries;
- evidence requirements;
- security expectations;
- migration ownership by phase.

Claude must not invent additional P0 tables without a confirmed requirement.

The database exists to support:

```text
Demo Merchant
→ Razorpay Test Mode Payment
→ Verified Webhook Evidence
→ Controlled Chaos Run
→ Processing Evidence
→ Money Invariant Result
→ Finding
→ Diagnosis
→ Regression
→ Reliability Score
```

The database is not a financial ledger and is not a replacement for Razorpay.

---

# 1. Database Purpose

Supabase PostgreSQL is the durable system record for PayChaos-owned state.

The database must preserve enough structured evidence to answer:

- which Demo Merchant order was tested;
- which Razorpay Order was created;
- which Razorpay Payment was observed;
- which webhook was genuinely delivered by Razorpay;
- whether that webhook was authentic;
- whether the event was delivered more than once;
- whether PayChaos replayed or simulated an event;
- which merchant-side business effects occurred;
- which chaos scenario ran;
- what fault was injected;
- which deterministic invariant evaluated the result;
- why an invariant passed, failed, or returned UNKNOWN;
- which finding was produced;
- which diagnosis/recommendation was produced;
- whether the issue later passed regression.

The database must support evidence reconstruction without depending on:

- browser memory;
- temporary server memory;
- AI conversation history;
- free-form logs alone.

---

# 2. Why PostgreSQL / Supabase Is Used

PayChaos uses Supabase PostgreSQL because it provides the required P0 capabilities in one simple system:

- relational integrity;
- transactions;
- foreign keys;
- unique constraints;
- check constraints;
- JSONB where controlled flexible evidence is useful;
- indexes;
- Row Level Security;
- free-tier deployment;
- straightforward migration support.

PostgreSQL is particularly important for PayChaos because correctness protections such as webhook deduplication must not rely only on application code.

For example:

```text
Two duplicate webhook requests arrive concurrently
```

must not become:

```text
Two canonical webhook records
```

simply because two server requests both checked the database before either inserted.

A database unique constraint must protect that boundary.

---

# 3. Database Design Principles

## Principle 1 — Keep P0 Small

Create only tables that protect payment correctness, evidence, chaos execution, diagnosis, or regression.

---

## Principle 2 — Relational Fields for Important Truth

Important identities and states belong in normal columns.

JSONB must not become a replacement for a data model.

---

## Principle 3 — JSONB Only for Flexible Evidence

Approved P0 JSONB uses are:

- redacted webhook payload evidence;
- normalized event snapshot;
- merchant-state before/after snapshots;
- chaos fault configuration/state;
- invariant evidence references.

---

## Principle 4 — Money Uses Integers

All monetary amounts are stored in the smallest currency subunit.

For INR:

```text
₹500.00
=
50000 paise
```

Use:

```text
bigint
```

Never use floating point for payment amounts.

---

## Principle 5 — Server Owns Authoritative Writes

The browser must not directly modify:

- payment state;
- Razorpay identifiers;
- webhook evidence;
- fulfilments;
- chaos results;
- invariant results;
- findings;
- regression state.

---

## Principle 6 — External Evidence Is Preserved

Verified Razorpay webhook evidence must not be silently rewritten.

Derived correlation/status fields may be updated, but the original event identity and evidence hash remain stable.

---

## Principle 7 — Historical Results Are Not Rewritten

A successful regression does not delete an earlier failure.

Historical evidence remains available.

---

## Principle 8 — UNKNOWN Is a Valid Result

Incomplete evidence must not become fake PASS.

---

# 4. Smallest Sensible P0 Schema

The final P0 schema contains these **10 tables**:

```text
1. orders
2. payment_attempts
3. payments
4. fulfilments
5. webhook_events
6. event_processing_attempts
7. chaos_runs
8. invariant_results
9. findings
10. regression_runs
```

This is the complete approved P0 table set.

---

# 5. Candidate Entities Deliberately Removed or Combined

## `merchants` — NOT REQUIRED

P0 contains one controlled Demo Merchant.

There is no multi-tenancy.

A merchant table would add no useful P0 integrity.

The Demo Merchant identity remains application configuration.

---

## Separate `razorpay_orders` — NOT REQUIRED

Razorpay Order information belongs to:

```text
payment_attempts
```

because each PayChaos payment attempt owns its server-created Razorpay Order.

---

## `payments` — REQUIRED

A separate payment table is retained.

Reason:

A Razorpay Order/payment attempt may need to preserve one or more Razorpay payment identities without forcing payment state into the merchant order row.

This keeps:

```text
Merchant Order
Payment Attempt
Razorpay Payment
```

as different concepts.

---

## `chaos_scenario_runs` — NOT REQUIRED

`chaos_runs` already represents one execution of one static scenario.

The scenario catalogue remains defined in TypeScript, not duplicated into a database table.

---

## `audit_events` — NOT REQUIRED FOR P0

A generic audit table would duplicate more useful domain evidence.

The P0 audit trail is provided by:

```text
webhook_events
event_processing_attempts
fulfilments
chaos_runs
invariant_results
findings
regression_runs
```

plus structured server logs.

---

## `fault_injection_settings` — NOT REQUIRED

Fault configuration belongs to the specific:

```text
chaos_runs
```

record.

This prevents global persistent fault settings accidentally affecting later payments.

---

## Separate `evidence` Table — NOT REQUIRED

Evidence is already represented by strongly typed domain records.

Invariant results store references to the relevant records.

Do not copy the same webhook/payment information into another generic evidence table.

---

## Separate `diagnoses` Table — NOT REQUIRED

P0 has one current deterministic diagnosis per finding.

Diagnosis fields therefore belong on:

```text
findings
```

---

## Separate `recommendations` Table — NOT REQUIRED

P0 has one deterministic recommendation associated with the finding's diagnosis.

Recommendation fields also belong on:

```text
findings
```

---

## `reliability_scores` — NOT REQUIRED FOR P0

The current Reliability Score is deterministic and can be calculated from persisted results.

P0 must calculate it from:

```text
invariant_results
+
findings
+
regression_runs
+
eligible chaos_runs
```

Persisted score history is optional P1.

---

# 6. Core Entity Relationships

The primary relationship chain is:

```text
Order
  ↓
Payment Attempt
  ↓
Razorpay Payment
  ↓
Verified Webhook Event
  ↓
Event Processing Attempt
  ↓
Fulfilment / Merchant State
```

The reliability chain is:

```text
Payment Attempt
      ↓
Chaos Run
      ↓
Event Processing Attempts
      ↓
Invariant Results
      ↓
Finding
      ↓
Diagnosis + Recommendation
      ↓
Regression Run
```

---

# 7. Mermaid ER Diagram

```mermaid
erDiagram
    ORDERS ||--o{ PAYMENT_ATTEMPTS : has
    PAYMENT_ATTEMPTS ||--o{ PAYMENTS : observes
    ORDERS ||--o{ FULFILMENTS : produces
    PAYMENTS ||--o{ FULFILMENTS : authorizes

    PAYMENT_ATTEMPTS ||--o{ WEBHOOK_EVENTS : correlates
    PAYMENTS ||--o{ WEBHOOK_EVENTS : correlates

    WEBHOOK_EVENTS ||--o{ EVENT_PROCESSING_ATTEMPTS : processed_as
    PAYMENT_ATTEMPTS ||--o{ EVENT_PROCESSING_ATTEMPTS : concerns
    PAYMENTS ||--o{ EVENT_PROCESSING_ATTEMPTS : concerns

    ORDERS ||--o{ CHAOS_RUNS : tested_by
    PAYMENT_ATTEMPTS ||--o{ CHAOS_RUNS : tested_by
    PAYMENTS ||--o{ CHAOS_RUNS : may_target
    WEBHOOK_EVENTS ||--o{ CHAOS_RUNS : may_replay

    CHAOS_RUNS ||--o{ EVENT_PROCESSING_ATTEMPTS : causes
    EVENT_PROCESSING_ATTEMPTS o|--o{ FULFILMENTS : triggers

    ORDERS ||--o{ INVARIANT_RESULTS : evaluated_for
    PAYMENT_ATTEMPTS ||--o{ INVARIANT_RESULTS : evaluated_for
    PAYMENTS ||--o{ INVARIANT_RESULTS : may_evaluate
    CHAOS_RUNS ||--o{ INVARIANT_RESULTS : produces

    INVARIANT_RESULTS ||--o| FINDINGS : may_create

    FINDINGS ||--o{ REGRESSION_RUNS : retested_by
    CHAOS_RUNS ||--o| REGRESSION_RUNS : executes
```

---

# 8. Shared Database Conventions

## 8.1 Primary Keys

All internal primary keys use:

```text
uuid
```

with a PostgreSQL-generated UUID default.

Do not use Razorpay IDs as primary keys.

---

## 8.2 Time

Use:

```text
timestamptz
```

for all timestamps.

Do not use timezone-less timestamps for payment evidence.

---

## 8.3 Money

Use:

```text
bigint
```

for amount in smallest currency subunits.

---

## 8.4 Currency

Use:

```text
varchar(3)
```

with uppercase three-letter validation.

Default P0 currency:

```text
INR
```

---

## 8.5 Internal Statuses

Internal state fields use:

```text
text + CHECK constraint
```

instead of native PostgreSQL enums.

Reason:

For a one-week build, `text` with explicit CHECK constraints provides strong validation while making controlled additions easier to migrate.

---

## 8.6 External Razorpay Statuses

Fields such as:

```text
razorpay_order_status
razorpay_payment_status
```

remain plain `text`.

Do not create a PostgreSQL enum based on Razorpay's external status catalogue.

---

## 8.7 Updated Timestamps

Mutable tables contain:

```text
updated_at timestamptz
```

Application services must update this field when authoritative mutable state changes.

A generic database trigger is optional, not required for P0.

---

# 9. TABLE — `orders`

## Purpose

Represents the Demo Merchant's internal business order.

This is the root merchant-side record.

It is **not** a Razorpay Order.

---

## Table Definition

| Column | PostgreSQL Type | Nullable? | Default | Constraints | Purpose |
|---|---|---:|---|---|---|
| `id` | `uuid` | No | generated UUID | PRIMARY KEY | Internal Demo Merchant order ID |
| `amount_subunits` | `bigint` | No | — | `> 0` | Expected merchant order amount |
| `currency` | `varchar(3)` | No | `'INR'` | uppercase 3-letter currency | Merchant order currency |
| `payment_status` | `text` | No | `'UNPAID'` | CHECK approved values | Merchant application's payment state |
| `business_status` | `text` | No | `'OPEN'` | CHECK approved values | Merchant business/fulfilment-facing state |
| `created_at` | `timestamptz` | No | `now()` | — | Creation time |
| `updated_at` | `timestamptz` | No | `now()` | — | Last state update |

---

## `payment_status` Values

```text
UNPAID
PENDING
FAILED_OBSERVED
PAID
```

`FAILED_OBSERVED` is intentionally not permanently terminal.

Later verified captured evidence may move the order to:

```text
PAID
```

---

## `business_status` Values

P0 requires only:

```text
OPEN
FULFILLED
```

Do not add ecommerce states unless required.

---

## Important Rules

### Rule ORD-001

`amount_subunits` and `currency` become immutable after the first payment attempt exists.

### Rule ORD-002

The browser cannot directly set:

```text
payment_status = PAID
```

### Rule ORD-003

`PAID` must derive from verified payment evidence.

### Rule ORD-004

`FULFILLED` must correspond to an actual successful fulfilment effect.

---

## Indexes

Required:

- primary-key index on `id`;
- index on `created_at`;
- index on `payment_status`;
- index on `business_status`.

---

## Phase Ownership

Created:

**Phase 1**

Core fields become stable after Phase 1 approval.

---

# 10. TABLE — `payment_attempts`

## Purpose

Represents one PayChaos attempt to pay a Demo Merchant order.

A payment attempt owns the server-created Razorpay Order.

One merchant order may have multiple payment attempts.

---

## Table Definition

| Column | Type | Nullable? | Default | Constraints | Purpose |
|---|---|---:|---|---|---|
| `id` | `uuid` | No | generated UUID | PRIMARY KEY | Internal payment-attempt ID |
| `order_id` | `uuid` | No | — | FK → `orders.id` | Merchant order |
| `attempt_no` | `smallint` | No | — | `> 0`, UNIQUE with `order_id` | Sequence for the merchant order |
| `amount_subunits` | `bigint` | No | — | `> 0` | Amount sent to Razorpay |
| `currency` | `varchar(3)` | No | `'INR'` | currency check | Attempt currency |
| `status` | `text` | No | `'CREATED'` | CHECK approved values | Internal attempt lifecycle |
| `razorpay_receipt` | `text` | No | — | UNIQUE | Stable Razorpay Order receipt/idempotency correlation |
| `razorpay_order_id` | `text` | Yes | `NULL` | partial UNIQUE when non-null | Razorpay Test Mode Order ID |
| `razorpay_order_status` | `text` | Yes | `NULL` | — | Latest verified/observed Razorpay Order status |
| `created_at` | `timestamptz` | No | `now()` | — | Created time |
| `updated_at` | `timestamptz` | No | `now()` | — | Last update |

---

## `status` Values

```text
CREATED
ORDER_CREATED
CHECKOUT_IN_PROGRESS
FAILED_OBSERVED
CAPTURED
```

A failure observation is not necessarily terminal.

---

## Constraints

Required:

```text
UNIQUE(order_id, attempt_no)
UNIQUE(razorpay_receipt)
UNIQUE(razorpay_order_id) WHERE razorpay_order_id IS NOT NULL
```

---

## Important Rules

### PAYATT-001

`amount_subunits` and `currency` must initially match the associated `orders` values.

### PAYATT-002

The attempt amount/currency must not later be silently changed.

### PAYATT-003

`razorpay_receipt` is generated once and reused when resolving an ambiguous Razorpay Order-creation outcome.

### PAYATT-004

A timeout must not generate a new receipt merely to retry.

### PAYATT-005

`razorpay_order_id` comes only from the trusted server Razorpay integration.

---

## Indexes

Required:

- `order_id`;
- `status`;
- `created_at`;
- unique indexes above.

---

## Phase Ownership

### Phase 1

Creates the foundational table including:

- ID;
- order relation;
- attempt number;
- amount;
- currency;
- basic status;
- stable receipt.

### Phase 2

Uses/adds the Razorpay Order correlation fields if not included in the initial migration.

Adding the already-approved Phase 2 Razorpay fields is not considered an architecture redesign.

---

# 11. TABLE — `payments`

## Purpose

Represents a canonical Razorpay Test Mode Payment observed by PayChaos.

It separates:

```text
merchant order
```

from:

```text
payment attempt / Razorpay Order
```

from:

```text
actual Razorpay Payment
```

---

## Table Definition

| Column | Type | Nullable? | Default | Constraints | Purpose |
|---|---|---:|---|---|---|
| `id` | `uuid` | No | generated UUID | PRIMARY KEY | Internal payment record |
| `payment_attempt_id` | `uuid` | No | — | FK → `payment_attempts.id` | Parent attempt/Razorpay Order |
| `razorpay_payment_id` | `text` | No | — | UNIQUE | Razorpay Test Mode Payment ID |
| `razorpay_payment_status` | `text` | Yes | `NULL` | — | Latest verified/observed provider status |
| `amount_subunits` | `bigint` | No | — | `> 0` | Payment amount |
| `currency` | `varchar(3)` | No | `'INR'` | currency check | Payment currency |
| `checkout_signature_verified` | `boolean` | No | `false` | — | Whether Checkout response was server-verified |
| `checkout_verified_at` | `timestamptz` | Yes | `NULL` | consistency CHECK | Verification timestamp |
| `first_observed_at` | `timestamptz` | No | `now()` | — | First observed payment evidence |
| `last_observed_at` | `timestamptz` | No | `now()` | — | Most recent verified observation |
| `captured_at` | `timestamptz` | Yes | `NULL` | — | First verified capture observation |
| `failed_at` | `timestamptz` | Yes | `NULL` | — | Verified failure observation |
| `error_code` | `text` | Yes | `NULL` | — | Safe Razorpay error code |
| `error_description_redacted` | `text` | Yes | `NULL` | — | Redacted failure description |
| `error_source` | `text` | Yes | `NULL` | — | Razorpay error source |
| `error_step` | `text` | Yes | `NULL` | — | Razorpay error step |
| `error_reason` | `text` | Yes | `NULL` | — | Razorpay error reason |
| `created_at` | `timestamptz` | No | `now()` | — | Record creation |
| `updated_at` | `timestamptz` | No | `now()` | — | Last update |

---

## Checkout Verification Constraint

If:

```text
checkout_signature_verified = true
```

then:

```text
checkout_verified_at
```

must not be null.

Do not persist the Razorpay Key Secret or webhook secret.

The Checkout signature itself does not need to be permanently stored.

---

## Important Rules

### PAY-001

`razorpay_payment_id` is globally unique in PayChaos.

### PAY-002

A verified `payment.failed` observation does not prevent a later verified transition to captured state.

### PAY-003

`CAPTURED`-equivalent provider evidence is stronger than a previous failure observation.

### PAY-004

Amount correctness is evaluated against:

```text
orders.amount_subunits
```

and:

```text
payment_attempts.amount_subunits
```

### PAY-005

Browser state cannot update authoritative payment status directly.

---

## Indexes

Required:

- UNIQUE `razorpay_payment_id`;
- index `payment_attempt_id`;
- index `razorpay_payment_status`;
- index `created_at`.

---

## Phase Ownership

Created:

**Phase 2**

---

# 12. TABLE — `fulfilments`

## Purpose

Records actual Demo Merchant business effects caused by successful payment processing.

This table exists so PayChaos can determine:

```text
0 fulfilments
1 fulfilment
more than 1 fulfilment
```

for the same order.

---

## Table Definition

| Column | Type | Nullable? | Default | Constraints | Purpose |
|---|---|---:|---|---|---|
| `id` | `uuid` | No | generated UUID | PRIMARY KEY | Business-effect ID |
| `order_id` | `uuid` | No | — | FK → `orders.id` | Fulfilled merchant order |
| `payment_id` | `uuid` | No | — | FK → `payments.id` | Payment authorizing effect — **added in Phase 2** (not present in the Phase 1 migration; see Column Phasing Note and Phase Ownership below) |
| `trigger_processing_attempt_id` | `uuid` | Yes | `NULL` | FK → `event_processing_attempts.id` | Processing attempt that caused effect — added in Phase 2 (see Phase Ownership below) |
| `effect_type` | `text` | No | `'FULFIL_ORDER'` | CHECK P0 value | Business effect |
| `idempotency_key` | `text` | No | — | UNIQUE | Business-effect idempotency boundary |
| `applied_at` | `timestamptz` | No | `now()` | — | Actual effect time |
| `created_at` | `timestamptz` | No | `now()` | — | Audit creation time |

---

## Column Phasing Note

This table definition describes the **complete, final** `fulfilments` schema. Not every column is
created by the Phase 1 migration.

- `payment_id` — **deferred to Phase 2.** `payments` does not exist until Phase 2, so a `NOT NULL`
  foreign key to it cannot be created in Phase 1. Phase 1 creates `fulfilments` **without** this
  column. Phase 2 creates `payments` first, then adds `payment_id` to the already-approved Phase 1
  `fulfilments` table through a **new additive migration** — never by editing or rewriting the
  original Phase 1 migration.
- `trigger_processing_attempt_id` — deferred to Phase 2 for the same reason
  (`event_processing_attempts` does not exist until Phase 2), added through an additive migration, as
  already documented in Phase Ownership below.

Phase 2 adds these columns through one or more additive migration files, as technically appropriate.
The exact migration-file grouping is an implementation choice; what is fixed is that both columns are
added on top of the approved Phase 1 table, never by rewriting it.

**Phase 1 must not insert any row into `fulfilments`.** No authoritative payment evidence exists in
Phase 1 — there is no `payments` table and no verified capture — so no Phase 1 code path may
populate this table. The table exists in Phase 1 only to establish the approved business-effect
representation and the future duplicate-fulfilment detection model; it remains empty until Phase 2.

---

## P0 `effect_type`

```text
FULFIL_ORDER
```

No other business-effect types are necessary.

---

## Idempotency Model

Correct processing uses a stable semantic key such as:

```text
FULFIL_ORDER:<order-id>
```

The exact string format is implementation-level.

The critical requirement is:

**the same logical fulfilment must reuse the same idempotency key.**

Database uniqueness protects against concurrent duplicate inserts.

---

## Order / Payment Consistency Rule

A `fulfilments.order_id` and `fulfilments.payment_id` must refer to the same logical payment path.

Before inserting a normal fulfilment, trusted server processing must resolve:

```text
payments.id
→ payments.payment_attempt_id
→ payment_attempts.order_id
```

and require:

```text
payment_attempts.order_id = fulfilments.order_id
```

This validation must occur inside the same trusted transaction that applies the fulfilment/business-state change.

P0 does **not** add a new table or redundant foreign-key column solely to encode this relationship. `INV-010` and the required integration test provide the cross-record correctness check in addition to the normal foreign keys.

A mismatch must be rejected with zero fulfilment/business-state mutation.

---

## Chaos Testing Note

A controlled faulty merchant profile may deliberately demonstrate missing semantic idempotency by generating different keys for what is actually the same logical fulfilment.

That is:

```text
PAYCHAOS_SIMULATION
```

behavior.

It must not be presented as normal architecture.

The Money Invariant Engine then detects:

```text
COUNT(successful fulfilments for order) > 1
```

---

## Indexes

Required:

- UNIQUE `idempotency_key`;
- index `order_id`;
- index `payment_id` — created with the column in Phase 2, not part of the Phase 1 migration;
- index `trigger_processing_attempt_id` — created with the column in Phase 2, not part of the Phase 1 migration;
- index `applied_at`.

---

## Phase Ownership

### Phase 1

Creates the business-effect representation **without `payment_id`**: `id`, `order_id`, `effect_type`,
`idempotency_key`, `applied_at`, `created_at`, plus their constraints and indexes (excluding the
`payment_id` index, which arrives with the column in Phase 2). This establishes the approved
business-effect model and the future duplicate-fulfilment (`COUNT(fulfilments) <= 1`) design ahead of
the payment evidence that will populate it.

Phase 1 must not insert a fulfilment row. No authoritative payment evidence exists yet — there is no
`payments` table and no verified capture — so no Phase 1 code path may write to this table. It stays
empty until Phase 2.

### Phase 2

Connects fulfilment to verified payment/event processing, through one or more additive migrations —
as technically appropriate — to the already-approved Phase 1 `fulfilments` table:

1. **`payment_id`** — added once `payments` exists (`payments` is itself created in Phase 2, before
   this migration). The column must be:

   ```text
   payment_id uuid NOT NULL REFERENCES payments(id)
   ```

   using `ON DELETE RESTRICT`, consistent with the FK/delete-semantics default this document already
   establishes in Section 41 for important evidence relationships.

2. **`trigger_processing_attempt_id`** — added once `event_processing_attempts` exists, nullable,
   `FK → event_processing_attempts.id`.

Whether these two columns are added by one migration file or two is an implementation choice. What
is fixed is that each may only be added once its referenced table exists, and neither may be added by
altering the original Phase 1 migration.

**The original Phase 1 `fulfilments` migration must never be rewritten to insert either column.**
Once Phase 1 is approved, its migrations are immutable; every later requirement is layered on
through new migration files only. This preserves the approved Phase 1 migration history and keeps
each schema change traceable to the phase that required it.

---

# 13. TABLE — `webhook_events`

## Purpose

Stores the canonical representation of a genuine, signature-verified Razorpay Test Mode webhook event.

One logical Razorpay event has one canonical row.

Duplicate HTTP deliveries do **not** create additional canonical rows.

---

## Table Definition

| Column | Type | Nullable? | Default | Constraints | Purpose |
|---|---|---:|---|---|---|
| `id` | `uuid` | No | generated UUID | PRIMARY KEY | Internal event ID |
| `razorpay_event_id` | `text` | No | — | UNIQUE | `x-razorpay-event-id` |
| `event_type` | `text` | No | — | — | Razorpay webhook event type |
| `source_kind` | `text` | No | `'REAL_RAZORPAY_WEBHOOK'` | CHECK fixed value | Evidence provenance |
| `razorpay_order_id` | `text` | Yes | `NULL` | — | Order ID observed in payload |
| `razorpay_payment_id` | `text` | Yes | `NULL` | — | Payment ID observed in payload |
| `payment_attempt_id` | `uuid` | Yes | `NULL` | FK → `payment_attempts.id` | Derived internal correlation |
| `payment_id` | `uuid` | Yes | `NULL` | FK → `payments.id` | Derived payment correlation |
| `signature_verified` | `boolean` | No | — | CHECK must be true | Authentication evidence |
| `received_at` | `timestamptz` | No | `now()` | — | Server receipt time |
| `provider_created_at` | `timestamptz` | Yes | `NULL` | — | Event/provider timestamp if available |
| `amount_subunits` | `bigint` | Yes | `NULL` | `>0` when present | Normalized amount evidence |
| `currency` | `varchar(3)` | Yes | `NULL` | currency check | Normalized currency |
| `razorpay_payment_status` | `text` | Yes | `NULL` | — | Payment state from payload |
| `raw_body_sha256` | `char(64)` | No | — | length/hex validation | Integrity hash of original raw body |
| `raw_payload_redacted` | `jsonb` | No | `{}` | must be object | Safe redacted evidence |
| `processing_status` | `text` | No | `'RECEIVED'` | CHECK approved values | Canonical event processing state |
| `processed_at` | `timestamptz` | Yes | `NULL` | — | Successful processing time |
| `duplicate_delivery_count` | `integer` | No | `0` | `>=0` | Number of extra real deliveries detected |
| `updated_at` | `timestamptz` | No | `now()` | — | Status/counter update time |

---

## `source_kind`

For this canonical table the only permitted P0 value is:

```text
REAL_RAZORPAY_WEBHOOK
```

PayChaos replay is **not** inserted as a new webhook event.

---

## `processing_status`

```text
RECEIVED
PROCESSING
PROCESSED
FAILED
```

---

## Immutable Fields

After initial verified insertion, these should not be rewritten during ordinary operation:

```text
razorpay_event_id
event_type
source_kind
signature_verified
received_at
provider_created_at
raw_body_sha256
raw_payload_redacted
```

Derived correlation/status fields may be updated.

---

## Duplicate Protection

Required database constraint:

```text
UNIQUE(razorpay_event_id)
```

This is the primary transport/event deduplication safeguard.

---

## Important Rule

An invalid webhook signature does **not** create a row in `webhook_events`.

Rejected requests may appear in safe structured operational logs.

They do not become trusted Razorpay evidence.

---

## Indexes

Required:

- UNIQUE `razorpay_event_id`;
- `payment_attempt_id`;
- `payment_id`;
- `razorpay_order_id`;
- `razorpay_payment_id`;
- `(event_type, received_at)`;
- `processing_status`.

---

## Phase Ownership

Created:

**Phase 2**

---

# 14. TABLE — `event_processing_attempts`

## Purpose

Records every meaningful attempt to process an event through the PayChaos internal Event Processor.

This table is essential because:

```text
event identity
```

is not the same as:

```text
processing attempt
```

It captures:

- first real Razorpay delivery;
- duplicate real delivery;
- retry after previous processing failure;
- PayChaos replay;
- PayChaos simulation;
- automated-test fixture processing where persisted in test environments.

---

## Table Definition

| Column | Type | Nullable? | Default | Constraints | Purpose |
|---|---|---:|---|---|---|
| `id` | `uuid` | No | generated UUID | PRIMARY KEY | Processing attempt ID |
| `webhook_event_id` | `uuid` | Yes | `NULL` | FK → `webhook_events.id` | Source real event when applicable |
| `payment_attempt_id` | `uuid` | Yes | `NULL` | FK → `payment_attempts.id` | Payment attempt correlation |
| `payment_id` | `uuid` | Yes | `NULL` | FK → `payments.id` | Payment correlation |
| `chaos_run_id` | `uuid` | Yes | `NULL` | FK → `chaos_runs.id` | Chaos/replay association |
| `source_kind` | `text` | No | — | CHECK approved values | Provenance |
| `is_duplicate_delivery` | `boolean` | No | `false` | — | Real HTTP duplicate indicator |
| `status` | `text` | No | `'PENDING'` | CHECK approved values | Processing lifecycle |
| `fault_action` | `text` | Yes | `NULL` | — | Fault primitive applied |
| `normalized_event` | `jsonb` | No | `{}` | object | Safe normalized processor input |
| `state_before` | `jsonb` | Yes | `NULL` | object | Merchant state before processing |
| `state_after` | `jsonb` | Yes | `NULL` | object | Merchant state after processing |
| `error_code` | `text` | Yes | `NULL` | — | Safe processing error |
| `error_message_redacted` | `text` | Yes | `NULL` | — | Redacted processing detail |
| `started_at` | `timestamptz` | No | `now()` | — | Processing start |
| `finished_at` | `timestamptz` | Yes | `NULL` | — | Completion time |

---

## `source_kind` Values

```text
REAL_RAZORPAY_WEBHOOK
PAYCHAOS_REPLAY
PAYCHAOS_SIMULATION
TEST_FIXTURE
```

This is the **complete, final** approved provenance vocabulary. Not every value is currently accepted by
the database — see "Column/Value Phasing Note" below.

---

## Column/Value Phasing Note (added Phase 3C)

The Table Definition and `source_kind` Values above describe the **complete, final** approved schema.
As of the Phase 3C migration (`supabase/migrations/20260830000000_phase3c_controlled_replay.sql`), the
`event_processing_attempts_source_kind_valid` CHECK constraint currently accepts exactly:

```text
REAL_RAZORPAY_WEBHOOK
PAYCHAOS_REPLAY
```

`PAYCHAOS_SIMULATION` and `TEST_FIXTURE` remain **approved future target values** — real, pre-approved
provenance kinds this table's final design accounts for — but they are **not yet enabled by the current
CHECK constraint**. They stay unimplemented surface until the later phases that actually produce them
(C07/C11 fault mechanisms; fixture work) exist, per the same "do not widen unused attack surface merely
because a future phase might need it" reasoning the original Phase 2E migration used to defer all three
non-`REAL_RAZORPAY_WEBHOOK` values in the first place.

Similarly, `chaos_run_id` is a real column as of Phase 3C. `state_before`/`state_after` are added by
the **Phase 3E-A** migration `supabase/migrations/20260901000000_phase3e_evidence_snapshots.sql`
(status: **IMPLEMENTED IN REPOSITORY / MANUALLY APPLIED / REAL SUPABASE VERIFIED** — see Section 44). `fault_action`
remains deferred: Phase 3E-A deliberately did not add it, because the evidence-snapshot work has no
dependency on it and the run-level fault primitive `chaos_runs.fault_type` remains authoritative. It
stays pre-approved but unimplemented surface until a phase genuinely produces it.

A `PAYCHAOS_REPLAY` row must additionally satisfy the new
`event_processing_attempts_replay_provenance_valid` CHECK: `webhook_event_id IS NOT NULL`,
`chaos_run_id IS NOT NULL`, and `is_duplicate_delivery = false` — a replay references genuine canonical
evidence but is explicitly **not** a genuine duplicate HTTP delivery from Razorpay, so it must never
increment `webhook_events.duplicate_delivery_count` or be counted as one.

---

## `status` Values

```text
PENDING
HELD
PROCESSING
SUCCEEDED
FAILED
SKIPPED_DUPLICATE
```

---

## Provenance Constraints

### `REAL_RAZORPAY_WEBHOOK`

Must have:

```text
webhook_event_id
```

---

### `PAYCHAOS_REPLAY`

Must have:

```text
webhook_event_id
chaos_run_id
```

---

### `PAYCHAOS_SIMULATION`

Must have:

```text
chaos_run_id
```

A real webhook reference is optional.

---

### `TEST_FIXTURE`

Allowed only in test/local contexts.

It must never be presented as real Razorpay evidence.

---

## Duplicate Delivery Rules

When Razorpay genuinely sends the same `razorpay_event_id` again:

1. `webhook_events` retains one canonical row;
2. `duplicate_delivery_count` increments;
3. a new processing-attempt record may be created;
4. `is_duplicate_delivery = true`;
5. business-effect idempotency still applies.

---

## Evidence Snapshot Rule

`state_before` and `state_after` exist because the mutable `orders` record may later change.

Historical chaos evidence must not be reconstructed solely from the current order row.

### Implemented shape (Phase 3E-A)

Both columns are **nullable `jsonb`, with no default**, each constrained to a JSON **object** or
`NULL`:

- `event_processing_attempts_state_before_is_object`
- `event_processing_attempts_state_after_is_object`

The persisted value is a versioned envelope (`{ version: 1, order, paymentAttempt, payment,
fulfilments }`) built by `lib/evidence/merchant-state-snapshot.ts` from an **explicit allowlist
projection** — internal ids, internal/provider states, integer `amount_subunits`, `currency`, a
checkout-verification boolean, and persisted historical timestamps. It never contains a raw Razorpay
webhook body, a `raw_payload_redacted` copy, a signature, any secret, any customer PII, or any
LLM/diagnosis/confidence text (Section 38). Fulfilments are sorted by `id` ascending so the same
database state always yields the same snapshot.

A missing entity is recorded as `null` rather than invented; `fulfilments` is `null` when the owning
order could not be resolved, and `[]` only when the order WAS resolved and genuinely had none.

### Set-once application rule

Both columns are **write-once**. `lib/evidence/evidence-repository.ts` writes each through a single
atomic conditional update, so a retry, a duplicate delivery or a replay can never rewrite historical
evidence (Principle 7). A zero-row match is reported as `ALREADY_CAPTURED` and the pre-existing value
is preserved and returned.

### Processing-lifecycle rule — snapshots are never backfilled

Set-once alone is **not** sufficient. It prevents an *overwrite* of a non-null value; it does nothing
about a **late first write** into a column that is still `NULL` — and every pre-Phase-3E row is `NULL`
by design.

This matters because the frozen `process_webhook_payment_event` transaction is idempotent on
re-entry: an attempt that succeeded earlier can be passed to `processMerchantWebhookEvent` again and
returns `outcome = "already_processed"`. Without a second guard, that re-entry would read the
merchant state *as it is today* and persist it into the still-`NULL` `state_before`, producing
evidence that claims to describe the state around the *original* processing. That is fabricated
history.

Therefore a snapshot is created **only when the current invocation is legitimately participating in
that attempt's processing lifecycle**:

- **`state_before`** carries the lifecycle guard in the write itself:
  `UPDATE ... WHERE id = $1 AND status = 'PENDING' AND state_before IS NULL`. Both predicates are
  evaluated by Postgres in one statement, so the write is race-safe: if another caller processes the
  attempt in between, the stale caller matches zero rows instead of writing a late "before".
- **`state_after`** cannot use a status predicate (the row is already `SUCCEEDED`/`FAILED` by then).
  Its lifecycle condition is a property of the invocation — "this call began from a genuinely
  `PENDING` attempt and just performed its processing" — enforced in `lib/events/processor.ts`, which
  resolves eligibility *before* invoking the processor.
- **`PENDING` is the only eligible status.** `PROCESSING` is deliberately excluded even though the
  frozen RPC admits it: it means an earlier invocation already began this attempt's lifecycle, so a
  later arrival is a recovery re-entry, not the fresh execution the "before" state describes.
  `HELD`, `SUCCEEDED`, `FAILED` and `SKIPPED_DUPLICATE` are terminal/non-runnable and equally
  ineligible.
- **`already_processed`** never produces a `state_after`, and a `PROCESSING_ATTEMPT_NOT_READY`
  failure never produces a late `state_after`.
- **An eligibility read failure** results in no snapshots at all, with merchant processing entirely
  unchanged.

Consequences, stated plainly: **historical pre-Phase-3E attempts are never reconstructed or
backfilled**, and a terminal idempotent re-entry never fills in missing snapshots. A `NULL` on a
non-`PENDING` row is *valid historical truth* — "this snapshot was never captured" — and is reported
as `NOT_ELIGIBLE`, never treated as persistence corruption to be repaired.

### No generic evidence table

Nothing here introduces an `evidence_snapshots`/`chaos_evidence`/`evidence` table — Section 31
stands: evidence lives on the existing records and is later referenced by
`invariant_results.evidence_refs`.

### A missing snapshot is valid

`NULL` truthfully means "this evidence was not durably captured", and it is **authoritative** —
strictly preferable to a reconstructed value. Snapshot capture is instrumentation AROUND the frozen
`process_webhook_payment_event` transaction: it never participates in that transaction, and a
capture failure leaves the column `NULL` rather than fabricating state or altering merchant
processing. A later invariant evaluation that requires a snapshot it does not have must return
`UNKNOWN` (Principle 8) — never a fabricated `PASS`.

This is why neither column is `NOT NULL`, why the Phase 3E-A migration performs no backfill, and why
the processing-lifecycle rule above exists: a snapshot generated today would be a false claim about a
processing attempt that ran in the past. Snapshots are captured **only for future eligible processing
executions**.

---

## Indexes

Required:

- `webhook_event_id`;
- `payment_attempt_id`;
- `payment_id`;
- `chaos_run_id`;
- `(source_kind, started_at)`;
- `status`;
- `is_duplicate_delivery` where useful.

---

## Phase Ownership

### Phase 2

Creates processing-attempt tracking for genuine webhook processing. `source_kind` is CHECK-fixed to
exactly `REAL_RAZORPAY_WEBHOOK`; `chaos_run_id`/`fault_action`/`state_before`/`state_after` do not exist
yet.

### Phase 3B

Adds `chaos_runs` (a separate table). Does not modify `event_processing_attempts` at all.

### Phase 3C

Adds, via a new additive migration (never editing the Phase 2E/2F migration files):

- `chaos_run_id` (nullable FK → `chaos_runs.id`, `ON DELETE RESTRICT`) plus its index;
- widens `source_kind` to `REAL_RAZORPAY_WEBHOOK` + `PAYCHAOS_REPLAY` only (not the full four-value
  target vocabulary — see "Column/Value Phasing Note" above);
- the `event_processing_attempts_replay_provenance_valid` CHECK;
- a narrow, signature-preserving revision of the `process_webhook_payment_event` transaction's
  processing-attempt provenance admission gate (`supabase/migrations/20260828000000_phase2f_merchant_processing.sql`'s
  function body is never edited on disk — the revision lives entirely in the new Phase 3C migration via
  `CREATE OR REPLACE FUNCTION` with the identical signature).

### Phase 3E-A

Adds, via a new additive migration (never editing the Phase 2E/2F/3C/3D migration files):

- `state_before` (nullable `jsonb`, no default) plus its
  `event_processing_attempts_state_before_is_object` CHECK;
- `state_after` (nullable `jsonb`, no default) plus its
  `event_processing_attempts_state_after_is_object` CHECK;
- an explanatory `comment on column` for each.

No index is added (neither column is a lookup key), no `GRANT`/`REVOKE`/RLS surface changes, no
backfill, and no other table is touched. Migration status:
**IMPLEMENTED IN REPOSITORY / MANUALLY APPLIED / REAL SUPABASE VERIFIED** — see Section 44.

### Later Phase 3 (deferred)

- `PAYCHAOS_SIMULATION` / `TEST_FIXTURE` source kinds;
- `fault_action`.

These remain pre-approved but unimplemented until the phases that actually produce them exist.

---

# 15. TABLE — `chaos_runs`

## Purpose

Represents one execution of one predefined PayChaos chaos scenario.

There is no separate `chaos_scenarios` database table.

`scenario_id` points to the static scenario registry in application code.

---

## Table Definition

| Column | Type | Nullable? | Default | Constraints | Purpose |
|---|---|---:|---|---|---|
| `id` | `uuid` | No | generated UUID | PRIMARY KEY | Chaos run ID |
| `scenario_id` | `text` | No | — | CHECK approved values | Stable scenario catalogue ID |
| `order_id` | `uuid` | **Yes** | `NULL` | FK → `orders.id` | Merchant order being tested, when one applies |
| `payment_attempt_id` | `uuid` | **Yes** | `NULL` | FK → `payment_attempts.id` | Payment attempt being tested, when one exists |
| `payment_id` | `uuid` | Yes | `NULL` | FK → `payments.id` | Specific payment if applicable |
| `source_webhook_event_id` | `uuid` | Yes | `NULL` | FK → `webhook_events.id` | Verified source evidence for replay |
| `status` | `text` | No | `'PENDING'` | CHECK approved values | Run lifecycle |
| `outcome` | `text` | Yes | `NULL` | CHECK approved values | Aggregate scenario outcome |
| `fault_type` | `text` | **Yes** | `NULL` | CHECK approved values | Fault primitive used, when the scenario has one |
| `failed_precheck_id` | `text` | **Yes** | `NULL` | CHECK approved values | Which PRECHECK-01..10 blocked this run at CREATION time |
| `execution_block_code` | `text` | **Yes** | `NULL` | `chaos_runs_execution_block_code_valid` (`NULL` or `'PRE-SEC-007'`) | Which EXECUTION-TIME PRE-SEC-xxx check blocked this already-persisted PENDING run immediately before mechanism execution began — **added in Phase 3D-0** (see Phase Ownership below) |
| `fault_config` | `jsonb` | No | `{}` | object | Immutable requested fault configuration |
| `fault_state` | `jsonb` | No | `{}` | object | Runtime hold/release/transient state, plus C03's `mutationEvidence` (see "C03 `fault_state` shape" below) |
| `data_classification` | `text` | No | **none** | CHECK | Real/synthetic classification — must be supplied explicitly |
| `error_message_redacted` | `text` | Yes | `NULL` | — | Run failure detail |
| `started_at` | `timestamptz` | Yes | `NULL` | — | Actual run start — remains `NULL` for a BLOCKED run (execution never began) |
| `completed_at` | `timestamptz` | Yes | `NULL` | — | Actual run end, or BLOCKED finalization time |
| `created_at` | `timestamptz` | No | `now()` | — | Creation |
| `updated_at` | `timestamptz` | No | `now()` | — | Last status update |

### C03 `fault_state` shape (Phase 3F evidence-compatibility correction)

`chaos_runs.fault_state` carries **exactly one of two key sets** for a C03 run, and nothing else. A third key, a renamed key, or a generic pass-through blob is rejected by the reader.

```text
LEGACY   { checks }
CURRENT  { checks, mutationEvidence }
```

`mutationEvidence` is the before/after Demo Merchant state that `docs/MONEY_INVARIANTS.md` INV-005 §6 requires:

```text
mutationEvidence = {
  version: 1,
  before:  <C03MutationSnapshotV1> | null,
  after:   <C03MutationSnapshotV1> | null
}

C03MutationSnapshotV1 = {
  version: 1,
  orders:               { count, rows, complete } | null,
  paymentAttempts:      { count, rows, complete } | null,
  payments:             { count, rows, complete } | null,
  fulfilments:          { count, rows, complete } | null,
  trustedWebhookEvents: { count, ids,  complete } | null
}
```

**Why it exists.** C03 is verification-only by design: it calls the real signature-verification primitive directly and creates **no** `webhook_events` row and **no** `event_processing_attempts` row. That is correct, but it also means C03 has no `state_before`/`state_after` pair — those columns live on a processing attempt, and C03 correctly never creates one. Without this evidence INV-005 could only ever have evaluated `UNKNOWN`, which would leave the only executable invalid-signature scenario permanently unable to prove its own core safety property.

**No migration was required.** `fault_state` is already `jsonb NOT NULL DEFAULT '{}'` with only a `jsonb_typeof(fault_state) = 'object'` CHECK.

**Scope.** There is **no `merchant_id`/tenant column anywhere** in this schema, so the snapshot covers the whole controlled Demo Merchant dataset across the five tables INV-005 §6 names. One is never invented to manufacture a narrower scope.

**State, not just counts.** The four business collections carry full row-state projections, reusing the frozen `MerchantStateSnapshot*V1` field vocabulary. An order can move `UNPAID → PAID` and a payment can gain a `captured_at` while the row count stays identical, so a count-only snapshot would miss real money mutation. `trustedWebhookEvents` is the deliberate exception and carries internal UUIDs plus an exact count, because INV-005's webhook clause is an insertion test.

**Truthful incompleteness.** A `null` collection means the read FAILED and is never conflated with `{count: 0, rows: [], complete: true}` (read successfully, genuinely empty). `complete: false` means the bounded read (cap: 200 rows) was truncated; two truncated prefixes must never be compared and called "unchanged". Both are factual incompleteness that Phase 3F turns into `UNKNOWN` — never into a fabricated `PASS`, and never into a `FAIL`.

**Historical rows are never backfilled.** The already-approved historical C03 run carries the LEGACY `{checks}` shape. It stays that way permanently: INV-004 `NOT_APPLICABLE`, INV-005 `UNKNOWN`. A snapshot taken today would be a false claim about a run that executed in the past.

**Test precondition (ARCH-3F-014).** C03 must be run in the controlled Demo Merchant sandbox with **no concurrent payment flow in progress**. An unrelated concurrent payment landing between the two captures would change the snapshot, and this evidence cannot distinguish that from a mutation C03 caused. The control is an operator rule, not a lock — no advisory lock, queue, worker, extra table or extra precheck is introduced.

**This is evidence, not a verdict.** Nothing in the chaos or evidence layer compares `before` against `after`. That comparison is INV-005's decision and belongs to the Phase 3F Money Invariant Engine.

**Nullable links (architect-approved correction — Phase 3B):** `order_id`/`payment_attempt_id`/`payment_id`/`source_webhook_event_id` are all nullable because not every P0 scenario has an entity/evidence target at chaos-run creation time. C03 (Mechanism C) targets PayChaos's own fixed internal webhook-verification path and has no merchant order at all. C07 and C11 Mechanism A begin from a fresh order, but the frozen Phase 3A precheck contract never guarantees that order already has a `payment_attempts` row — Checkout, which creates the attempt, happens after a chaos run is requested. These links are never fabricated merely to populate the column; a `NULL` link is preferred over a false one.

`fault_type` is nullable because C11 has no unsafe fault primitive of its own (`allowedFaultTypes: []` in the frozen scenario registry) — it is `NULL` for both of its mechanisms, never a fabricated fourth "no fault" primitive.

---

## `status`

```text
PENDING
RUNNING
COMPLETED
FAILED
```

---

## `outcome`

```text
PASS
FAIL
UNKNOWN
BLOCKED
ERROR
```

`outcome` is null while a run is incomplete.

`NOT RUN` is **not** a stored `chaos_runs.outcome`. It is a derived catalogue/UI state meaning no eligible completed run exists for that scenario in the evaluation context.

A run blocked by a failed safety/prerequisite precheck may be finalized with:

```text
status = COMPLETED
outcome = BLOCKED
failed_precheck_id = <the PRECHECK-xx that blocked it>
execution_block_code = NULL
error_message_redacted = <safe reason>
started_at = NULL
completed_at = <finalization time>
```

A run blocked at EXECUTION time (Phase 3D-0 onward) — a chaos run that was
already durably persisted as `PENDING`, but whose mechanism was refused
immediately before execution began — is finalized with the mirror shape:

```text
status = COMPLETED
outcome = BLOCKED
failed_precheck_id = NULL
execution_block_code = 'PRE-SEC-007'
error_message_redacted = <safe reason>
started_at = NULL
completed_at = <finalization time>
```

Exactly one of `failed_precheck_id`/`execution_block_code` is non-null on a
BLOCKED row — never both, never neither (enforced by
`chaos_runs_blocked_state_consistent`, below).

In both cases the run is finalized without executing replay/fault injection.
`started_at` remains `NULL` for a BLOCKED run because execution never
actually began.

Detailed correctness still comes from individual:

```text
invariant_results
```

---

## `failed_precheck_id`

```text
PRECHECK-01
PRECHECK-02
PRECHECK-03
PRECHECK-04
PRECHECK-05
PRECHECK-06
PRECHECK-07
PRECHECK-08
PRECHECK-09
PRECHECK-10
```

Records which of the ten official Chaos Run Precheck IDs (Section 11)
blocked this run. `NULL` for a `PENDING` row. Not every BLOCKED precheck
category is necessarily persisted here — `PRECHECK-01`/`02`/`03` (global
server/config failure), `PRECHECK-05` (unregistered/disabled/malformed
scenario), and `PRECHECK-06` (audit database itself unreachable) are not
scenario-attributable or cannot be durably recorded, so the phase that owns
this decision may choose not to create a row for them at all. Only
`PRECHECK-07`/`08`/`09`/`10` against an independently-confirmed registered
scenario are eligible.

---

## `execution_block_code`

**Added in Phase 3D-0** (`supabase/migrations/20260831000000_phase3d_execution_safety.sql`).

```text
PRE-SEC-007
```

`text`, nullable, `NULL` by default and `NULL` for every run this does not
apply to. Constrained by `chaos_runs_execution_block_code_valid`:

```text
execution_block_code IS NULL
  OR execution_block_code = 'PRE-SEC-007'
```

`PRE-SEC-007` (required server secrets exist) is currently the **only**
allowed non-null value. This column is deliberately **not** a generic
unrestricted PRE-SEC code catalogue — it holds exactly the one value Phase
3D-0 has a genuine, execution-time use for. Widening it would require its own
approved migration.

### `execution_block_code` vs `failed_precheck_id`

These record two structurally different kinds of block and must never be
conflated:

| | `failed_precheck_id` | `execution_block_code` |
|---|---|---|
| When | **CREATION time** | **EXECUTION time** |
| Catalogue | `PRECHECK-01`..`PRECHECK-10` (Section 11) | `PRE-SEC-xxx` (`docs/SECURITY.md`) |
| Run state at block | The request **never became** a persisted `PENDING` run | An already-persisted `PENDING` run exists; its mechanism was refused immediately before execution began |
| Currently allowed | `PRECHECK-07`/`08`/`09`/`10` (see above) | `PRE-SEC-007` only |

### PRE-SEC checks deliberately NOT stored here

- **`PRE-SEC-010`** is **not** represented as an `execution_block_code`. It
  is the HTTP/session authorization boundary, enforced at the untrusted route
  before the execution service is ever allowed to act on the
  already-persisted chaos run. A caller rejected there never reaches the
  execution service, so no execution-time block row is written for it.
- **`PRE-SEC-011`** is **not** represented as an `execution_block_code`
  either. It is structurally satisfied by the mere existence of the
  already-persisted `chaos_runs` row itself (this document's "audit path
  satisfying PRE-SEC-011") — it is never a distinct block reason.

---

## Consistency Constraints

```text
chaos_runs_blocked_state_consistent
chaos_runs_pending_state_consistent
chaos_runs_execution_block_code_valid
```

Both state-consistency constraints were **revised in Phase 3D-0** to account
for `execution_block_code`. Their current (authoritative) form:

**`chaos_runs_blocked_state_consistent`** — for a row with
`outcome = 'BLOCKED'`, guarantees ALL of:

```text
status               = 'COMPLETED'
exactly one of:
  failed_precheck_id   non-null  AND  execution_block_code  NULL
  failed_precheck_id   NULL      AND  execution_block_code  non-null
error_message_redacted  non-null
started_at              NULL
completed_at            non-null
```

Never both blocking identifiers, never neither. For any row whose outcome is
**not** `BLOCKED`, both `failed_precheck_id` and `execution_block_code` are
`NULL`. This preserves every valid pre-Phase-3D-0 BLOCKED row shape unchanged
(`failed_precheck_id` set, `execution_block_code` `NULL` is exactly the old
accepted shape); the execution-time shape is purely additive.

**`chaos_runs_pending_state_consistent`** — guarantees a `PENDING` row always
has ALL of:

```text
outcome                NULL
failed_precheck_id     NULL
execution_block_code   NULL
started_at             NULL
completed_at           NULL
```

(`execution_block_code IS NULL` was the Phase 3D-0 addition; every other
lifecycle rule is unchanged.)

**`chaos_runs_execution_block_code_valid`** — see the
`execution_block_code` section above.

All are enforced at the database level, not only in application code
(docs/ARCHITECTURE.md Section 25). None constrains future
`RUNNING`/`COMPLETED`-with-`PASS`/`FAIL`/`UNKNOWN`/`ERROR`/`FAILED`-status
semantics — those belong to whichever later phase actually executes a
mechanism.

---

## `data_classification`

```text
RECORDED_TEST_EVIDENCE
SYNTHETIC_DEMO
```

`text`, `NOT NULL`, **NO DEFAULT** (architect correction). This column must
be supplied explicitly by trusted server code on every insert — omitting it
fails the insert closed rather than silently defaulting to either value.

This is deliberate fail-closed provenance handling:
`RECORDED_TEST_EVIDENCE` is authoritative genuine-evidence metadata, so a
server-side bug or a future writer must never be able to omit this column
and silently receive the strongest/genuine-evidence classification by
default. Defaulting to `SYNTHETIC_DEMO` instead was considered and rejected
too, since that could just as easily silently misclassify a genuine run in
the other direction. The only safe behavior is to require every writer to
decide and state the classification explicitly, and to reject the insert
entirely if it does not.

This column is never caller/browser controlled — it is always derived by
trusted server code (`lib/chaos/run-service.ts`) from the scenario/mechanism
being persisted, never read from a browser-supplied request field.

A replay of a genuine verified Razorpay Test Mode event remains:

```text
RECORDED_TEST_EVIDENCE
```

because the original evidence is real even though processing is replayed.

A fully synthetic fallback/demo scenario must use:

```text
SYNTHETIC_DEMO
```

and must be excluded from genuine reliability metrics unless the UI explicitly displays a synthetic/demo-only score.

---

## Fault Injection Storage

There is deliberately no global fault-settings table.

Every run contains its own:

```text
fault_type
fault_config
fault_state
```

This prevents a forgotten global fault from contaminating later payments.

---

## Indexes

Required:

- `scenario_id`;
- `order_id`;
- `payment_attempt_id`;
- `payment_id`;
- `source_webhook_event_id`;
- `(status, created_at)`;
- `(data_classification, completed_at)`.

### `chaos_runs_one_active_c07_fault_per_order_idx` (Phase 3D-0)

A **partial UNIQUE index** on `chaos_runs(order_id)`, with the predicate:

```text
scenario_id  = 'C07'
AND fault_type   = 'DROP_CLIENT_CONFIRMATION'
AND status       = 'RUNNING'
AND order_id IS NOT NULL
```

**Invariant it enforces:** at most **ONE** active `RUNNING`
C07/`DROP_CLIENT_CONFIRMATION` chaos run may exist for the same order at any
one time. This is database-enforced concurrency safety — a partial unique
index, not a table-level lock and not an application-level `if` check, per
this project's principle that PostgreSQL (not application code alone) must
protect a concurrency invariant it is capable of enforcing
(docs/ARCHITECTURE.md Section 25).

Scope clarifications — the partial predicate makes all of these true:

- It has **zero effect on C01/C03/C11** rows.
- It has **zero effect on C07 rows in `PENDING`/`COMPLETED`/`FAILED`** — only
  `RUNNING` rows are counted.
- It has **zero effect on `RUNNING` C07 rows for a different order**.
- It does **not** prevent a later C07 run for the same order: once an earlier
  run leaves `RUNNING` (any terminal status), the index no longer counts it,
  so a subsequent run for that order may become `RUNNING` again. This is a
  **concurrency boundary, not a permanent one-run-per-order limit**.
- It does **not** globally enable or arm a fault — fault state remains
  per-run (`fault_type`/`fault_config`/`fault_state`), per the "no global
  fault-settings table" rule above.

---

## Phase Ownership

Created:

**Phase 3** (Phase 3B — `20260829000000_phase3b_chaos_runs.sql`)

Modified:

**Phase 3D-0** — `supabase/migrations/20260831000000_phase3d_execution_safety.sql`
adds the `execution_block_code` column and its
`chaos_runs_execution_block_code_valid` CHECK, replaces
`chaos_runs_blocked_state_consistent` and
`chaos_runs_pending_state_consistent` with their `execution_block_code`-aware
forms, and adds the
`chaos_runs_one_active_c07_fault_per_order_idx` partial unique index. It is
purely additive: no existing column was removed or retyped, no previously
valid row shape became invalid, and the Phase 3B/3C migrations remain
byte-for-byte unchanged on disk.

Phase 3D-A, 3D-B, 3D-C, 3D-D, and 3D-E introduced **no migration** — every
later Phase 3D scenario sub-phase was implemented entirely against the
already-existing schema. In particular, `TEST_FIXTURE` remains a documented
future `source_kind` value that is **not** accepted by any current CHECK
constraint and has **no runtime database path** (see the Column/Value Phasing
Note); it is source-controlled sanitized test data only.

---

# 16. TABLE — `invariant_results`

## Purpose

Stores immutable results from the deterministic Money Invariant Engine.

This table is authoritative for:

```text
PASS
FAIL
UNKNOWN
```

AI output does not modify it.

---

## Table Definition

**Implemented by** `supabase/migrations/20260902000000_phase3f_invariant_results.sql` (Phase 3F-A). The table below is the AS-IMPLEMENTED schema, not a plan.

| Column | Type | Nullable? | Default | Constraints | Purpose |
|---|---|---:|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PRIMARY KEY | Evaluation ID |
| `invariant_id` | `text` | No | — | CHECK (INV-001…INV-012) | Stable invariant catalogue ID |
| `invariant_version` | `text` | No | `'1'` | — | Version of deterministic rule |
| `order_id` | `uuid` | **Yes** | `NULL` | FK → `orders.id` ON DELETE RESTRICT | Evaluated order, when one exists |
| `payment_attempt_id` | `uuid` | **Yes** | `NULL` | FK → `payment_attempts.id` ON DELETE RESTRICT | Evaluated payment attempt, when one exists |
| `payment_id` | `uuid` | Yes | `NULL` | FK → `payments.id` ON DELETE RESTRICT | Specific payment where applicable |
| `chaos_run_id` | `uuid` | Yes | `NULL` | FK → `chaos_runs.id` ON DELETE RESTRICT | Chaos execution; null for baseline. **Required for C03** — see the subject-anchor rule below |
| `result` | `text` | No | — | CHECK | PASS/FAIL/UNKNOWN |
| `severity` | `text` | No | — | CHECK | Risk severity snapshot |
| `expected_summary` | `text` | No | — | — | Expected deterministic condition |
| `observed_summary` | `text` | No | — | — | Actual observed condition |
| `reason` | `text` | No | — | — | Deterministic explanation |
| `evidence_refs` | `jsonb` | No | `'[]'` | CHECK `jsonb_typeof(...) = 'array'` | Structured references to evidence |
| `evaluated_at` | `timestamptz` | No | `now()` | — | Evaluation time |

---

## Architect Nullability Correction (Phase 3F-A, binding)

The pre-implementation version of the table above declared `order_id` and `payment_attempt_id` as **NOT NULL**. That was incorrect and is corrected here, exactly as the identical correction was already applied to `chaos_runs` in Phase 3B.

**C03 has no merchant order, no payment attempt and no payment at all.** Its Mechanism C targets PayChaos's own fixed internal webhook-verification path (`lib/chaos/c03-execution-service.ts`), which performs two HMAC checks and touches no merchant entity whatsoever. Every approved C03 chaos run carries all four correlation FKs as `NULL`.

A NOT NULL `order_id` would therefore force an INV-005 result to fabricate a link to an order the scenario never examined. `docs/MONEY_INVARIANTS.md` Section 12 and CLAUDE.md Section 12 both forbid this: **a `NULL` link is preferred over a false one.**

All four correlation columns are consequently nullable **individually**. The foreign key still applies whenever a value is non-null, and every one uses `ON DELETE RESTRICT` — no `CASCADE`, no `SET NULL`. A C03 evaluation is anchored to `chaos_run_id` plus the factual mutation evidence persisted on that run's `fault_state`.

---

## Subject Anchor — `invariant_results_subject_present`

Individually nullable is **not** the same as "all four may be `NULL` together". A row with `order_id`, `payment_attempt_id`, `payment_id` and `chaos_run_id` all `NULL` would be an orphan authoritative money verdict about nothing — untraceable to any durable subject. No legitimate evaluation produces one.

The migration therefore enforces:

```sql
constraint invariant_results_subject_present check (
  order_id is not null
  or payment_attempt_id is not null
  or payment_id is not null
  or chaos_run_id is not null
)
```

**No individual foreign key is `NOT NULL`.** The constraint only requires that at least one anchor exists.

| Evaluation shape | `order_id` | `payment_attempt_id` | `payment_id` | `chaos_run_id` | Accepted? |
|---|---|---|---|---|---|
| **C03** | `NULL` | `NULL` | `NULL` | **NON-NULL** | Yes |
| Baseline order evaluation | **NON-NULL** | `NULL` | `NULL` | `NULL` | Yes |
| Baseline payment-attempt evaluation | any | **NON-NULL** | any | `NULL` | Yes |
| Baseline payment evaluation | any | any | **NON-NULL** | `NULL` | Yes |
| Chaos evaluation with a merchant subject | NON-NULL | NON-NULL | NON-NULL | NON-NULL | Yes |
| Orphan | `NULL` | `NULL` | `NULL` | `NULL` | **REJECTED** |

**`chaos_run_id` is `NULL`-able only because baseline evaluation is supported.** A baseline evaluation still has a real merchant/payment subject. Conversely, **`chaos_run_id` is required for C03**: it is the sole correlation a C03 result can truthfully carry, so a C03 result without it would have no subject at all and is rejected.

---

## `invariant_id`

Constrained by CHECK to exactly the twelve frozen P0 catalogue IDs `INV-001`…`INV-012` (`docs/MONEY_INVARIANTS.md` Section 14). The P1 IDs `INV-013`/`INV-014` are rejected at the database, so an unapproved invariant can never be persisted as a P0 result. `lib/invariants/registry.ts` owns the same twelve IDs in TypeScript.

---

## `result`

```text
PASS
FAIL
UNKNOWN
```

**Exactly these three, enforced by CHECK.**

`NOT_APPLICABLE` and `ERROR` are **in-memory evaluation dispositions only** (`docs/MONEY_INVARIANTS.md` Sections 32/36/37/38). They have deliberately **no schema representation**: the database fails closed rather than allowing "the rule did not apply" or "the evaluator crashed" to be stored as though it were authoritative payment truth. `lib/invariants/types.ts` makes the same split at compile time — a non-persistable evaluation is a structurally different type with no `severity`/`expected_summary`/`observed_summary`, so it cannot reach a persistence call.

`UNKNOWN` **is** authoritative: it means the rule applied but the evidence was insufficient. It must never be read, scored or displayed as `PASS`.

---

## `severity`

```text
LOW
MEDIUM
HIGH
CRITICAL
```

Severity is stored as a snapshot so historical findings remain explainable even if catalogue configuration changes later.

---

## Evidence References

`evidence_refs` references records such as:

```text
ORDER
PAYMENT_ATTEMPT
PAYMENT
FULFILMENT
WEBHOOK_EVENT
EVENT_PROCESSING_ATTEMPT
CHAOS_RUN
```

This is the same list `docs/MONEY_INVARIANTS.md` Section 42 carries. An earlier version of this section abbreviated `EVENT_PROCESSING_ATTEMPT` to `PROCESSING_ATTEMPT`; the longer spelling — which matches the real `event_processing_attempts` table — is the correct one and is what `lib/invariants/types.ts` implements.

Each reference must contain exactly:

- evidence kind;
- internal UUID.

The database CHECK enforces only that `evidence_refs` is a **JSON array**. The per-element `{kind, id}` shape is owned by `lib/invariants/types.ts`, deliberately rather than by hand-written JSON-schema validation in SQL.

Never write into `evidence_refs`: a raw webhook payload, `normalized_event`, a signature, `raw_body_sha256`, a secret, customer PII, diagnosis text, recommendation text, or any AI output. The two-field shape exists precisely so there is nowhere to put them.

---

## Uniqueness

For a chaos run, one invariant should normally be evaluated once.

Required partial unique index (implemented as `invariant_results_chaos_run_invariant_uniq`):

```text
UNIQUE(chaos_run_id, invariant_id)
WHERE chaos_run_id IS NOT NULL
```

Baseline evaluation may occur more than once, so baseline rows (`chaos_run_id IS NULL`) are deliberately **not** forced into this uniqueness rule — the index is partial for exactly that reason.

Uniqueness is **not** placed on `invariant_id` alone: different chaos runs are different historical evaluations of the same rule, and all of them must be retained. There is no `UPSERT` path and no `FAIL → PASS` update path; application-level evaluation idempotency belongs to Phase 3F-C.

---

## Immutability

Once persisted, an invariant result must not change from:

```text
FAIL → PASS
```

A re-test creates a **new** result.

This is enforced by **privilege**, not merely by repository convention. The Phase 3F-A migration grants **no `UPDATE` on `invariant_results` to any role, including `service_role`** — a deliberate narrowing versus every other table in this project, all of which carry full CRUD. A future service-layer bug attempting to rewrite a `FAIL` into a `PASS` fails at the database. `lib/supabase/types.ts` reinforces this at compile time by typing the table's `Update` member as `never`.

`DELETE` **is** retained for `service_role`, because Section 39 "Reset Scope"/"Reset Order" lists `invariant_results` as step 3 of the intentional administrative Demo Reset. That is a controlled, explicitly documented operation — not normal application behavior.

---

## RLS and Privileges (as implemented)

```text
RLS:            enabled, ZERO policies
anon:           REVOKE ALL — no read, no write
authenticated:  REVOKE ALL — no read, no write
service_role:   GRANT SELECT, INSERT, DELETE   (no UPDATE, by design)
```

---

## Indexes

Required:

- `(chaos_run_id, invariant_id)` partial unique;
- `payment_attempt_id`;
- `payment_id`;
- `result`;
- `severity`;
- `evaluated_at`.

---

## Phase Ownership

Created:

**Phase 3F-A** — `supabase/migrations/20260902000000_phase3f_invariant_results.sql`.

Phase 3F-A creates this schema only. It ships **no evaluator**: the deterministic INV-001…INV-012 rules are Phase 3F-B, and evaluation orchestration/persistence is Phase 3F-C. No row is written by the migration.

---

# 17. TABLE — `findings`

## Purpose

Represents a reliability issue generated from one deterministic invariant failure.

P0 uses one finding per failed invariant result.

Diagnosis and recommendation are deliberately stored on the finding rather than separate tables.

---

## Table Definition

| Column | Type | Nullable? | Default | Constraints | Purpose |
|---|---|---:|---|---|---|
| `id` | `uuid` | No | generated UUID | PRIMARY KEY | Finding ID |
| `invariant_result_id` | `uuid` | No | — | FK + UNIQUE | Failed invariant result |
| `status` | `text` | No | `'OPEN'` | CHECK | Finding lifecycle |
| `title` | `text` | No | — | — | Human-readable finding title |
| `diagnosis_code` | `text` | Yes | `NULL` | — | Deterministic diagnosis category |
| `diagnosis_strength` | `text` | Yes | `NULL` | CHECK when present | Evidence-strength label |
| `diagnosis_summary` | `text` | Yes | `NULL` | — | Evidence-based explanation |
| `recommendation_code` | `text` | Yes | `NULL` | — | Deterministic recommendation ID |
| `recommendation_text` | `text` | Yes | `NULL` | — | Human-readable remediation |
| `diagnosed_at` | `timestamptz` | Yes | `NULL` | — | Diagnosis time |
| `resolved_at` | `timestamptz` | Yes | `NULL` | consistency CHECK | Resolution time |
| `created_at` | `timestamptz` | No | `now()` | — | Finding creation |
| `updated_at` | `timestamptz` | No | `now()` | — | Last lifecycle update |

---

## `status`

```text
OPEN
STILL_FAILING
RESOLVED
```

---

## `diagnosis_strength`

Approved P0 values:

```text
STRONG_EVIDENCE
PARTIAL_EVIDENCE
INSUFFICIENT_EVIDENCE
```

Do not invent probabilistic confidence percentages.

---

## Constraints

Required:

```text
UNIQUE(invariant_result_id)
```

This prevents one failed invariant execution from creating duplicate findings.

Application-level validation must ensure findings are created only for:

```text
invariant_results.result = FAIL
```

---

## Diagnosis / Recommendation Storage

Diagnosis is advisory.

It may never modify:

- payment status;
- order amount;
- invariant result;
- webhook authenticity.

---

## Indexes

Required:

- UNIQUE `invariant_result_id`;
- `status`;
- `diagnosis_code`;
- `created_at`.

---

## Phase Ownership

### Phase 3

Creates:

- finding ID;
- invariant relation;
- OPEN status;
- title;
- timestamps.

### Phase 4

Adds/uses:

- diagnosis;
- recommendation;
- regression lifecycle fields.

---

# 18. TABLE — `regression_runs`

## Purpose

Connects a finding to a new chaos run executed to verify whether the issue has been fixed.

The original finding remains unchanged as historical evidence.

---

## Table Definition

| Column | Type | Nullable? | Default | Constraints | Purpose |
|---|---|---:|---|---|---|
| `id` | `uuid` | No | generated UUID | PRIMARY KEY | Regression record |
| `finding_id` | `uuid` | No | — | FK → `findings.id` | Original issue |
| `chaos_run_id` | `uuid` | No | — | FK → `chaos_runs.id`, UNIQUE | Re-test chaos run |
| `status` | `text` | No | `'PENDING'` | CHECK | Regression lifecycle/result |
| `started_at` | `timestamptz` | Yes | `NULL` | — | Start |
| `completed_at` | `timestamptz` | Yes | `NULL` | — | End |
| `created_at` | `timestamptz` | No | `now()` | — | Creation |

---

## `status`

```text
PENDING
RUNNING
RESOLVED
STILL_FAILING
ERROR
```

---

## Regression Rules

### REG-001

A regression references a new `chaos_runs` record.

### REG-002

The new run must use the relevant original scenario.

### REG-003

The original invariant is reevaluated.

### REG-004

The original failed invariant result is never overwritten.

### REG-005

If the new relevant invariant passes, the finding may become:

```text
RESOLVED
```

### REG-006

If it fails again:

```text
STILL_FAILING
```

---

## Indexes

Required:

- UNIQUE `chaos_run_id`;
- `finding_id`;
- `status`;
- `created_at`.

---

## Phase Ownership

Created:

**Phase 4**

---

# 19. P1-Only Table — `reliability_score_snapshots`

This table is **not part of required P0**.

It may be added only if P1 reliability-history/trend UI is selected.

Current P0 score is derived on demand.

---

## Purpose

Store historical deterministic score snapshots so the UI can display genuine score changes over time.

---

## Table Definition

| Column | Type | Nullable? | Default | Constraints | Purpose |
|---|---|---:|---|---|---|
| `id` | `uuid` | No | generated UUID | PRIMARY KEY | Snapshot |
| `score` | `smallint` | No | — | `0 <= score <= 100` | Reliability Score |
| `readiness_status` | `text` | No | — | approved readiness values | Go-Live status |
| `algorithm_version` | `text` | No | — | — | Deterministic formula version |
| `breakdown` | `jsonb` | No | `{}` | object | Explainable score components |
| `included_run_count` | `integer` | No | `0` | `>=0` | Eligible runs |
| `unknown_count` | `integer` | No | `0` | `>=0` | UNKNOWN evaluations |
| `data_cutoff_at` | `timestamptz` | No | — | — | Latest evidence included |
| `computed_at` | `timestamptz` | No | `now()` | — | Snapshot time |

---

## P1 Rule

Never generate fake history.

Every snapshot must derive from real stored PayChaos results.

Synthetic/demo-only runs must not be silently included.

---

# 20. Reliability Score Storage — P0 Decision

P0 does **not** persist a score row.

The current score is calculated from durable source records.

Conceptually:

```text
Eligible Chaos Runs
+
Invariant Results
+
Finding Status
+
Regression Results
        ↓
Deterministic Score Function
        ↓
Current Score + Breakdown
```

Benefits:

- one less P0 table;
- no stale score state;
- deterministic recalculation;
- easier one-week implementation.

If trend history becomes P1:

add `reliability_score_snapshots`.

---

# 21. Data Ownership

PayChaos P0 is a controlled single-workspace application.

Therefore:

- no tenant ID;
- no merchant account table;
- no organization table;
- no user-owned payment data model.

The server owns authoritative application data.

The browser is a presentation/request layer.

---

# 22. Payment / Order State Consistency

The database does not attempt to replace deterministic domain logic with complicated triggers.

However, the following rules are mandatory.

## Rule STATE-001 — Money Values Agree

At payment-attempt creation:

```text
orders.amount_subunits
=
payment_attempts.amount_subunits
```

and currencies must match.

---

## Rule STATE-002 — Captured Amount Is Verified

For a successful payment:

```text
payments.amount_subunits
=
orders.amount_subunits
```

unless an explicitly supported future use case says otherwise.

The Money Invariant Engine verifies this.

---

## Rule STATE-003 — Browser Does Not Mark Paid

`orders.payment_status = PAID` requires trusted server evidence.

---

## Rule STATE-004 — Failure Is Not Necessarily Terminal

A payment previously observed as failed may later have verified captured evidence.

Database/application logic must permit this.

---

## Rule STATE-005 — Fulfilment Requires Verified Payment

Normal P0 processing creates a fulfilment only for verified captured payment state.

---

## Rule STATE-006 — Fulfilment Exactly Once

Correct processing uses a stable business idempotency key.

---

## Rule STATE-007 — State Cannot Regress Incorrectly

Out-of-order events must not move:

```text
PAID
```

back to:

```text
FAILED_OBSERVED
```

simply because the failure event was processed later.

---

# 23. Razorpay Identifiers Stored

Approved Razorpay identifiers include:

```text
razorpay_order_id
razorpay_payment_id
razorpay_event_id
razorpay_receipt
```

They are not secrets.

They may be stored because they are required for:

- correlation;
- webhook processing;
- evidence;
- troubleshooting;
- deterministic invariants.

---

# 24. Razorpay Credentials Never Stored

The database must never contain:

```text
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
```

These belong only in server environment-secret storage.

The Test Key ID also does not need database persistence.

---

# 25. Webhook Event Storage Strategy

For genuine Razorpay Test Mode webhooks, preserve:

```text
event identity
event type
provider IDs
signature verification result
receive time
redacted payload
raw-body SHA-256
normalized useful fields
processing state
duplicate-delivery count
```

Do not persist full raw sensitive bodies solely for convenience.

The raw-body hash provides evidence integrity without requiring indefinite raw-body storage.

---

# 26. Webhook Duplicate Detection

There are two levels.

## Level 1 — Canonical Event

Protected by:

```text
UNIQUE(webhook_events.razorpay_event_id)
```

---

## Level 2 — Business Effect

Protected by:

```text
UNIQUE(fulfilments.idempotency_key)
```

These solve different problems.

Webhook deduplication alone is insufficient.

---

# 27. Chaos Run Storage

`chaos_runs` contains:

- scenario ID;
- target order/payment;
- original webhook evidence when applicable;
- fault primitive;
- fault configuration;
- runtime fault state;
- run status;
- aggregate outcome;
- real/synthetic classification;
- timestamps.

A separate scenario table is unnecessary because the catalogue is static TypeScript configuration.

---

# 28. Chaos Scenario Result Storage

The high-level result is:

```text
chaos_runs.outcome
```

Detailed correctness results are:

```text
invariant_results
```

Do not duplicate the complete invariant result inside `chaos_runs`.

---

# 29. Money Invariant Result Storage

Invariant results are append-only historical records.

Each row records:

- which invariant ran;
- version;
- target payment/order;
- chaos run;
- PASS/FAIL/UNKNOWN;
- severity;
- expected result;
- observed result;
- deterministic reason;
- evidence references;
- evaluation time.

---

# 30. Finding Storage

A finding is created only from a deterministic FAIL.

The finding itself stores:

- lifecycle status;
- human-readable title;
- later diagnosis;
- later recommendation.

The failed invariant remains the underlying authoritative correctness record.

---

# 31. Evidence Storage

There is no generic evidence table.

Evidence comes from:

```text
orders
payment_attempts
payments
webhook_events
event_processing_attempts
fulfilments
chaos_runs
```

and is referenced from:

```text
invariant_results.evidence_refs
```

This keeps evidence structured and queryable.

---

# 32. Diagnosis and Recommendation Storage

P0 diagnosis and recommendation are one-to-one with a finding.

They are stored directly in `findings`.

This is simpler than creating:

```text
diagnoses
recommendations
```

tables.

If future P1 requires multiple competing diagnoses per finding, an architecture/database decision would be required before normalization.

---

# 33. Demo Merchant Data

P0 does not require:

```text
products
catalogs
inventory
customers
merchant_accounts
```

tables.

The single demo product/configuration can remain application configuration.

The database stores the actual order that was created from that Demo Merchant.

This prevents ecommerce scope creep.

---

# 34. Fault Injection Configuration

There is no persistent global fault-injection configuration.

Every fault exists inside one:

```text
chaos_runs
```

record.

Use:

```text
fault_type
fault_config
fault_state
```

This is safer because completing/failing one run does not leave the entire application in a fault-enabled state.

---

# 35. Regression / Re-Test Storage

A regression consists of:

```text
Finding
   ↓
regression_runs
   ↓
new chaos_runs row
   ↓
new invariant_results
```

The new results do not replace previous results.

---

# 36. Audit Requirements

The audit trail must make every important demo result explainable.

For a finding, it must be possible to reconstruct:

```text
Order
↓
Payment Attempt
↓
Razorpay Payment
↓
Original Webhook Event
↓
Processing Attempt(s)
↓
Chaos Run
↓
Merchant State Before/After
↓
Fulfilment Effect(s)
↓
Invariant Result
↓
Finding
↓
Diagnosis
↓
Regression
```

A generic `audit_events` table is unnecessary because these are stronger domain-specific records.

Structured server logs supplement this history.

They do not replace it.

---

# 37. Data Lifecycle

## Mutable Operational Records

May change as verified state evolves:

```text
orders
payment_attempts
payments
webhook_events.processing_status
chaos_runs.status/fault_state
findings.status/diagnosis
regression_runs.status
```

---

## Effectively Immutable Evidence

Normal application operation must not rewrite:

```text
webhook external identity
webhook raw-body hash
webhook redacted original evidence
event processing attempt history
fulfilment history
invariant results
completed chaos fault configuration
completed regression history
```

---

## Deletion

P0 has no normal end-user delete workflow.

Evidence remains until an explicit Demo Reset.

---

## Retention

No automated retention policy is required for the one-week buildathon.

Because PayChaos stores only Test Mode data and redacted evidence, records may remain for the demo period.

---

# 38. Sensitive Data That Must NEVER Be Stored

Never persist:

- card number/PAN;
- CVV;
- card PIN;
- authentication OTP;
- raw card credentials;
- real customer banking credentials;
- unnecessary bank account details;
- unnecessary VPA/UPI identity;
- unnecessary email address;
- unnecessary phone number;
- Razorpay Key Secret;
- Razorpay webhook secret;
- Supabase service-role/secret key;
- API passwords;
- full unredacted sensitive webhook payloads;
- secrets in JSONB;
- secrets in diagnostic text;
- secrets in error messages.

---

# 39. Security Considerations

## DB-SEC-001

Browser code must not hold privileged database credentials.

## DB-SEC-002

Authoritative writes occur through trusted Next.js server code.

## DB-SEC-003

Webhook event insertion occurs only after signature verification.

## DB-SEC-004

Database uniqueness protects external event identity.

## DB-SEC-005

Database uniqueness protects business-effect idempotency keys.

## DB-SEC-006

Redacted JSONB must contain whitelisted safe evidence only.

## DB-SEC-007

Test fixtures must never be relabeled as real Razorpay events.

## DB-SEC-008

Synthetic chaos runs must be marked:

```text
SYNTHETIC_DEMO
```

## DB-SEC-009

No normal browser action can reset the entire database.

---

# 40. Row Level Security

P0 should use the simplest safe model.

## Decision

Enable RLS on all application tables exposed through the Supabase API surface.

P0 does not require direct browser database access.

Therefore:

- browser `anon` access: **DENY**;
- browser authenticated direct writes: **DENY**;
- privileged server access: allowed through server-only Supabase credentials.

No permissive client policies are required for P0.

The frontend gets data through trusted Next.js server routes/services.

---

## Tables Requiring RLS

Enable RLS for:

```text
orders
payment_attempts
payments
fulfilments
webhook_events
event_processing_attempts
chaos_runs
invariant_results
findings
regression_runs
```

and P1 score snapshots if created.

---

# 41. Foreign-Key Deletion Policy

Normal application behavior should not delete reliability evidence.

Therefore P0 should prefer:

```text
ON DELETE RESTRICT
```

for important evidence relationships.

This prevents accidental deletion of an order from silently removing the entire finding history.

Derived correlation fields where loss of the relationship is acceptable may use:

```text
SET NULL
```

only if explicitly justified.

Demo reset is handled separately as an intentional administrative operation.

---

# 42. Index Summary

## `orders`

- PK `id`
- `created_at`
- `payment_status`
- `business_status`

## `payment_attempts`

- PK `id`
- UNIQUE `(order_id, attempt_no)`
- UNIQUE `razorpay_receipt`
- partial UNIQUE `razorpay_order_id`
- `order_id`
- `status`
- `created_at`

## `payments`

- PK `id`
- UNIQUE `razorpay_payment_id`
- `payment_attempt_id`
- `razorpay_payment_status`
- `created_at`

## `fulfilments`

- PK `id`
- UNIQUE `idempotency_key`
- `order_id`
- `payment_id`
- `trigger_processing_attempt_id`
- `applied_at`

## `webhook_events`

- PK `id`
- UNIQUE `razorpay_event_id`
- `payment_attempt_id`
- `payment_id`
- `razorpay_order_id`
- `razorpay_payment_id`
- `(event_type, received_at)`
- `processing_status`

## `event_processing_attempts`

- PK `id`
- `webhook_event_id`
- `payment_attempt_id`
- `payment_id`
- `chaos_run_id`
- `(source_kind, started_at)`
- `status`

## `chaos_runs`

- PK `id`
- `scenario_id`
- `order_id`
- `payment_attempt_id`
- `payment_id`
- `source_webhook_event_id`
- `(status, created_at)`
- `(data_classification, completed_at)`

## `invariant_results`

- PK `id`
- partial UNIQUE `(chaos_run_id, invariant_id)`
- `payment_attempt_id`
- `payment_id`
- `result`
- `severity`
- `evaluated_at`

## `findings`

- PK `id`
- UNIQUE `invariant_result_id`
- `status`
- `diagnosis_code`
- `created_at`

## `regression_runs`

- PK `id`
- UNIQUE `chaos_run_id`
- `finding_id`
- `status`
- `created_at`

---

# 43. Migration Strategy

All schema changes must use repository-managed migrations.

Expected location:

```text
supabase/migrations/
```

Do not manually modify the deployed database and leave the change undocumented.

---

## Migration Rules

### MIG-001

Every schema change receives a migration.

### MIG-002

Migrations are committed to Git.

### MIG-003

Migrations never contain secrets.

### MIG-004

Each phase owns only its approved migrations.

### MIG-005

A phase handoff lists every migration added.

### MIG-006

Fresh database setup must work by applying migrations in order.

### MIG-007

Do not squash approved phase migrations during the buildathon unless there is a confirmed reason.

Migration history is useful evidence of phase evolution.

---

# 44. Migration Ownership by Phase

## Phase 1

Creates foundational schema:

```text
orders
payment_attempts
fulfilments
```

plus:

- basic constraints;
- RLS;
- foundational indexes.

`fulfilments` is created **without** `payment_id` — see the `fulfilments` table's Column Phasing
Note and Phase Ownership sections. Phase 1 must not insert any fulfilment row.

No webhook, chaos, invariant, diagnosis, or regression tables yet.

---

## Phase 2

Creates:

```text
payments
webhook_events
event_processing_attempts
```

and finalizes approved Razorpay-related payment-attempt fields.

Also extends the approved Phase 1 `fulfilments` table through one or more additive migrations, as
technically appropriate, none of which may rewrite the original Phase 1 migration:

- **`fulfilments.payment_id`** — added once `payments` exists (created earlier in this same phase),
  as `uuid NOT NULL REFERENCES payments(id)` with `ON DELETE RESTRICT`.
- **`fulfilments.trigger_processing_attempt_id`** — added once `event_processing_attempts` exists,
  as a nullable `FK → event_processing_attempts.id`.

---

## Phase 3

Creates:

```text
chaos_runs
invariant_results
findings
```

and extends:

```text
event_processing_attempts
```

for:

- chaos-run linkage;
- replay/simulation provenance;
- fault evidence;
- before/after state snapshots.

### Phase 3 migrations actually applied (authoritative)

```text
20260829000000_phase3b_chaos_runs.sql            Phase 3B — creates chaos_runs
20260830000000_phase3c_controlled_replay.sql     Phase 3C — controlled replay support
20260831000000_phase3d_execution_safety.sql      Phase 3D-0 — execution-safety additions
```

**Phase 3D-0 — `20260831000000_phase3d_execution_safety.sql`** adds, all
additively:

- `chaos_runs.execution_block_code` (`text`, nullable);
- the `chaos_runs_execution_block_code_valid` CHECK (`NULL` or
  `'PRE-SEC-007'`);
- a revised `chaos_runs_blocked_state_consistent` (exactly one of
  `failed_precheck_id`/`execution_block_code` non-null on a BLOCKED row);
- a revised `chaos_runs_pending_state_consistent` (adds
  `execution_block_code IS NULL` to the PENDING requirement);
- the `chaos_runs_one_active_c07_fault_per_order_idx` partial unique index
  (at most one `RUNNING` C07/`DROP_CLIENT_CONFIRMATION` run per order).

See Section 15 (`chaos_runs`) for the full semantics of each.

**Phase 3D-A, 3D-B, 3D-C, 3D-D, and 3D-E introduced NO migration.** Every
later Phase 3D scenario sub-phase (C03, C07, the C11 fixture, C11-B replay,
C11-A observation) was implemented entirely against the already-existing
schema. It is therefore **not** correct to say "Phase 3D had no migrations" —
Phase 3D-0 had exactly one; the scenario sub-phases after it had none.

### Phase 3E migration — IMPLEMENTED IN REPOSITORY / MANUALLY APPLIED / REAL SUPABASE VERIFIED

```text
20260901000000_phase3e_evidence_snapshots.sql    Phase 3E-A — evidence-snapshot columns
```

**Phase 3E-A — `20260901000000_phase3e_evidence_snapshots.sql`** adds, all
additively, to `public.event_processing_attempts`:

- `state_before` (`jsonb`, **nullable**, no default);
- `state_after` (`jsonb`, **nullable**, no default);
- `event_processing_attempts_state_before_is_object`
  (`state_before IS NULL OR jsonb_typeof(state_before) = 'object'`);
- `event_processing_attempts_state_after_is_object`
  (`state_after IS NULL OR jsonb_typeof(state_after) = 'object'`);
- a `comment on column` for each.

It creates no table, adds no index, changes no `GRANT`/`REVOKE`/RLS surface,
performs no backfill, drops nothing, and does not add `fault_action` or widen
`event_processing_attempts_source_kind_valid`. See Section 14 for the full
semantics (versioned snapshot envelope, set-once write rule, and why `NULL`
is a valid value that later yields `UNKNOWN` rather than a fabricated `PASS`).

**Status: MANUALLY APPLIED and REAL SUPABASE VERIFIED.**

```text
Migration            20260901000000_phase3e_evidence_snapshots.sql
Manual application   YES
Applied by           the developer, manually
Application method   Supabase Dashboard -> SQL Editor -> Run
Application result   Success. No rows returned
Reapplied by tooling NO (never re-run, never `supabase db push`, never psql)
Real Supabase        VERIFIED
Verification test    tests/integration/supabase/060-phase3e-evidence-snapshot.integration.test.ts
060 result           1 file / 15 tests / 15 passed / 0 failed
Full Supabase suite  21 files / 234 tests / 234 passed / 0 failed
Environmental retry  none required
```

#### What real Supabase proved (060)

Executed against the live project AFTER the manual application, `060`
confirmed all of the following as real database behavior — not as a
repository-only claim:

- `state_before` exists; `state_after` exists;
- both accept JSON **objects**;
- a **scalar** snapshot value is rejected by the CHECK constraint;
- an **array** snapshot value is rejected by the CHECK constraint;
- a fresh, eligible `PENDING` processing attempt persists a real
  `state_before`;
- the same fresh processing persists a real `state_after`, with factually
  different pre/post content;
- `state_before` is **set-once**; `state_after` is **set-once**;
- the `state_before` first write requires `PENDING` lifecycle eligibility —
  `persistProcessingStateBefore` returns `NOT_ELIGIBLE` against real Postgres
  for a terminal row;
- a terminal `SUCCEEDED` attempt whose snapshots are `NULL` is **not**
  retroactively backfilled;
- an idempotent `already_processed` re-entry does **not** create a late
  `state_after`;
- a terminal `FAILED`/non-runnable attempt is **not** backfilled (and still
  raises `PROCESSING_ATTEMPT_NOT_READY`);
- the existing merchant-processing result semantics are **unchanged**;
- snapshot capture never alters `source_kind` — provenance is inherited, not
  rewritten;
- all synthetic test-owned rows were cleaned up (child-before-parent, with an
  independent zero-row proof).

`060` is **SYNTHETIC REAL-DATABASE MECHANICS VERIFICATION**. Its rows are
test-owned synthetic fixtures; it is never genuine Razorpay provider
evidence.

#### Historical rows were NOT backfilled (verified)

An independent read-only census taken after the full real-Supabase suite:

```text
event_processing_attempts total        20
rows with non-null state_before         0
rows with non-null state_after          0
```

Every pre-Phase-3E processing attempt — including all three genuine
`REAL_RAZORPAY_WEBHOOK` originals behind the approved C07 / C11-B / C11-A
manual evidence, and C11-B's `PAYCHAOS_REPLAY` attempt — correctly still
carries `state_before = NULL` / `state_after = NULL`. The approved Phase 3D
durable evidence itself (chaos runs, orders, payments, fulfilments) was
confirmed intact and unmutated.

**This is the desired result, not a gap.** Applying the migration
deliberately performs no backfill, and the application-side lifecycle
eligibility gate additionally prevents any later idempotent re-entry from
writing a late first snapshot into one of those historical rows. See Section
14's "historical NULL semantics" for why a reconstructed snapshot would be
false evidence.

---

### Phase 3F migration — IMPLEMENTED IN REPOSITORY / NOT YET APPLIED

```text
20260902000000_phase3f_invariant_results.sql     Phase 3F-A — invariant_results
```

**Phase 3F-A — `20260902000000_phase3f_invariant_results.sql`** creates
exactly one table, `public.invariant_results` (Section 16), with:

- all fourteen approved columns and no invented column;
- all four entity correlations **nullable**, every FK `ON DELETE RESTRICT`;
- `invariant_results_invariant_id_valid` (INV-001…INV-012 only);
- `invariant_results_result_valid` (`PASS`/`FAIL`/`UNKNOWN` only);
- `invariant_results_severity_valid` (`LOW`/`MEDIUM`/`HIGH`/`CRITICAL` only);
- `invariant_results_evidence_refs_is_array`;
- `invariant_results_subject_present` (at least one of `order_id` /
  `payment_attempt_id` / `payment_id` / `chaos_run_id` non-null — no
  individual column is NOT NULL);
- the partial unique index
  `invariant_results_chaos_run_invariant_uniq (chaos_run_id, invariant_id)
  WHERE chaos_run_id IS NOT NULL`, plus the five required non-unique indexes;
- RLS enabled with zero policies, `REVOKE ALL` from `anon`/`authenticated`,
  and `GRANT SELECT, INSERT, DELETE` — **no `UPDATE`** — to `service_role`.

It is purely additive: it alters no existing table, creates no function,
trigger or view, writes no row, and creates no Phase 4 table.

**Status: NOT YET APPLIED.**

```text
Migration            20260902000000_phase3f_invariant_results.sql
Manual application   NO — pending architect review
Real Supabase        NOT VERIFIED
Verification test    tests/integration/supabase/063-phase3f-invariant-results.integration.test.ts
063 result           not runnable until the migration is manually applied
```

`063` is committed in advance and must not be executed before the manual
application. Until then it fails with a "table not found in schema cache"
style error for every test — an expected pre-migration state, not a product
regression, and never to be worked around.

---

## Phase 4

Creates:

```text
regression_runs
```

and finalizes diagnosis/recommendation fields on:

```text
findings
```

No P0 score table is required.

---

## Phase 5

Should normally introduce **no new domain tables**.

Allowed migrations are limited to:

- confirmed constraint bug;
- security fix;
- required index;
- verified deployment correction.

---

# 45. Seed / Demo Data Strategy

## Default P0 Strategy

Do not seed fake completed payment histories into the canonical deployed database.

The main demo should create real Test Mode evidence through the application.

---

## Allowed Seed Data

Safe seed data may include:

- minimal internal development order examples;
- deterministic automated-test fixtures in a test database.

Do not seed:

- fake real Razorpay events;
- fake production payments;
- fake reliability history presented as real.

---

## Captured Razorpay Fixtures

Sanitized captured Razorpay Test Mode fixtures belong primarily in test fixture files.

If stored in a test database:

provenance must be:

```text
TEST_FIXTURE
```

---

## Synthetic Demo Data

If a fallback synthetic demo is later required:

every synthetic chaos run must use:

```text
data_classification = SYNTHETIC_DEMO
```

and the UI must label it.

Synthetic runs must not silently influence the genuine current reliability score.

---

# 46. Reset-Demo Strategy

The Demo Merchant must be resettable without recreating the Supabase project.

Reset is an intentional administrative/development operation.

It is not a normal customer-facing action.

---

## Reset Scope

Reset removes runtime/demo records from exactly these ten tables, and no
others. This is the SCOPE; the required deletion ORDER is in "Reset Order"
below, and the two are listed in the same sequence so they cannot be read as
disagreeing:

```text
fulfilments
regression_runs
event_processing_attempts
findings
invariant_results
chaos_runs
webhook_events
payments
payment_attempts
orders
```

---

## Reset Order

Every foreign key among the ten runtime tables is `ON DELETE RESTRICT`, so
deletion order is a correctness property, not a preference. Records are
deleted child-before-parent inside ONE transaction:

```text
1. fulfilments
2. regression_runs
3. event_processing_attempts
4. findings
5. invariant_results
6. chaos_runs
7. webhook_events
8. payments
9. payment_attempts
10. orders
```

CORRECTED (Phase 5). The order previously documented here placed
`event_processing_attempts` fourth and `fulfilments` seventh. That is not
dependency-safe: `fulfilments.trigger_processing_attempt_id` references
`event_processing_attempts (id) ON DELETE RESTRICT` (added by the Phase 2F
migration), so any fulfilment produced by a webhook pins its processing
attempt. A production reset failed on exactly this constraint.

`fulfilments` must therefore be deleted FIRST: it is the only runtime table
that references orders, payments AND event_processing_attempts.

## Reset and Supabase safeupdate

Supabase enables `safeupdate`, which refuses any `DELETE` or `UPDATE` that
carries no `WHERE` clause when executed in the API role's context. That
protection remains ENABLED. It is not disabled globally, per role, per
database, or temporarily inside the reset function.

The reset therefore qualifies every statement explicitly:

```sql
delete from public.<table> where id is not null;
```

Each of the ten runtime tables declares `id uuid primary key`, and PRIMARY KEY
implies NOT NULL, so the predicate is true for every row that exists: the
statement still clears the whole table while satisfying the guard.

`where id is not null` is preferred over `where true` because its
always-true-ness comes from a schema guarantee rather than from a literal, and
it states which key the sweep is over.

CONFIRMED IN PRODUCTION (Phase 5). Unqualified statements failed through the
application with SQLSTATE `21000`, "DELETE requires a WHERE clause", while
succeeding in the SQL editor — the editor does not run in the API role's
context. A static test now fails if any of the ten deletes loses its `WHERE`.

## Reset Atomicity

The reset is performed by a single database function,
`public.reset_paychaos_demo_runtime()`, which executes all ten deletes inside
one transaction.

**If the reset fails, zero reset-table mutations commit.** There is no partial
reset state, and no interface may describe one. The previous implementation
issued ten independent DELETE requests from application code; when one failed,
the earlier ones had already committed and left the database inconsistent.

The function takes no arguments, uses no dynamic SQL, and never uses `CASCADE`
or `TRUNCATE`. `EXECUTE` is revoked from `PUBLIC`, `anon` and `authenticated`,
and granted only to `service_role`.

---

## Reset Must NOT Delete

Never reset:

- database schema;
- migration history;
- RLS configuration;
- environment secrets;
- Razorpay configuration;
- source-controlled test fixtures.

---

## Security Rule

A reset operation must be:

- server-side;
- unavailable to arbitrary public requests;
- explicitly disabled or protected in the judge-facing deployment unless needed.

---

# 47. Database Failure Scenarios PayChaos Must Test

Database reliability is part of payment reliability.

At minimum test the following.

---

## DB-FAIL-001 — Concurrent Duplicate Webhook Insert

### Scenario

Two requests try to insert the same:

```text
razorpay_event_id
```

concurrently.

### Expected

Exactly one canonical `webhook_events` row exists.

No duplicate business effect occurs.

---

## DB-FAIL-002 — Duplicate Fulfilment Idempotency Key

### Scenario

Two processing attempts try to create the same business effect using the same idempotency key.

### Expected

At most one successful fulfilment row exists for that key.

---

## DB-FAIL-003 — Database Failure During Webhook Processing

### Scenario

The database operation fails before critical webhook processing is durable.

### Expected

- event is not incorrectly marked PROCESSED;
- merchant paid state is not falsely updated;
- webhook endpoint can return failure so Razorpay may retry;
- safe operational error is recorded.

---

## DB-FAIL-004 — Transaction Rolls Back

### Scenario

A merchant state update succeeds logically in application code but fulfilment persistence fails inside the same required transaction boundary.

### Expected

No partially committed authoritative business state.

---

## DB-FAIL-005 — Invalid Foreign Key

Attempt to create:

- payment for nonexistent payment attempt;
- fulfilment for nonexistent payment;
- invariant for nonexistent chaos run.

### Expected

Database rejects invalid relationship.

---

## DB-FAIL-006 — Out-of-Order State Update

Process older failure evidence after captured state.

### Expected

Merchant/payment state does not regress incorrectly.

---

## DB-FAIL-007 — Missing Evidence

Delete/omit required evidence in an isolated test fixture.

### Expected

Invariant result:

```text
UNKNOWN
```

rather than PASS.

---

## DB-FAIL-008 — Interrupted Chaos Run

A run starts but an internal operation fails before completion.

### Expected

Run remains explainably:

```text
FAILED
```

and does not appear as PASS.

---

## DB-FAIL-009 — Synthetic Data Scoring Protection

Introduce a:

```text
SYNTHETIC_DEMO
```

run.

### Expected

Normal genuine reliability calculation excludes it.

---

## DB-FAIL-010 — Unauthorized Browser Write

Attempt direct anon/client mutation of authoritative table.

### Expected

RLS denies it.

---

# 48. Database Tests

## 48.1 Migration Tests

Verify:

- fresh Supabase database can apply every migration;
- migrations execute in order;
- expected tables exist;
- expected constraints exist;
- expected indexes exist;
- RLS is enabled.

---

## 48.2 Constraint Tests

Test:

- negative amount rejected;
- zero amount rejected;
- invalid internal status rejected;
- duplicate receipt rejected;
- duplicate Razorpay Order ID rejected;
- duplicate Razorpay Payment ID rejected;
- duplicate Razorpay Event ID rejected;
- duplicate fulfilment idempotency key rejected;
- duplicate finding for one invariant result rejected;
- duplicate regression chaos-run link rejected.

---

## 48.3 Foreign-Key Tests

Verify orphaned:

- payment attempt;
- payment;
- fulfilment;
- webhook correlation;
- chaos run;
- invariant result;
- finding;
- regression

cannot be created when required parent data is missing.

---

## 48.4 Concurrency Tests

At minimum test database-level race behavior for:

```text
razorpay_event_id
```

and:

```text
fulfilments.idempotency_key
```

---

## 48.5 RLS Tests

Using unprivileged/anon access:

- SELECT denied unless explicitly approved;
- INSERT denied;
- UPDATE denied;
- DELETE denied.

Using trusted server credentials:

required operations succeed.

---

## 48.6 Evidence-Chain Test

Create one complete controlled test dataset and verify a query path can reconstruct:

```text
order
→ payment attempt
→ payment
→ webhook
→ processing attempt
→ chaos run
→ invariant
→ finding
```

---

## 48.7 Regression-History Test

Verify successful regression:

- creates new chaos run;
- creates new invariant result;
- updates finding status;
- does not delete original FAIL.

---

## 48.8 Reset Test

Verify reset:

- clears runtime demo data;
- leaves tables/migrations intact;
- leaves security policies intact.

---

# 49. Database Acceptance Criteria

## DB-AC-001

Every P0 table has one clear purpose.

## DB-AC-002

No unused P0 table exists.

## DB-AC-003

Orders, payment attempts and Razorpay payments remain separate concepts.

## DB-AC-004

Amounts use integer smallest-subunit storage.

## DB-AC-005

Razorpay Order IDs are uniquely protected.

## DB-AC-006

Razorpay Payment IDs are uniquely protected.

## DB-AC-007

Razorpay Event IDs are uniquely protected.

## DB-AC-008

Business-effect idempotency has a database uniqueness boundary.

## DB-AC-009

Real webhook identity is distinct from processing/replay attempts.

## DB-AC-010

Replay/simulation provenance is persisted.

## DB-AC-011

Raw webhook evidence is redacted and integrity-hashed.

## DB-AC-012

Invalid webhook payloads cannot become trusted event rows.

## DB-AC-013

Money invariant results support PASS/FAIL/UNKNOWN.

## DB-AC-014

Invariant history is immutable.

## DB-AC-015

Findings are traceable to exact failed invariant results.

## DB-AC-016

Diagnosis cannot overwrite authoritative invariant state.

## DB-AC-017

Regression does not delete original failures.

## DB-AC-018

Synthetic demo results can be identified and excluded from genuine scoring.

## DB-AC-019

Browser direct authoritative writes are blocked.

## DB-AC-020

No prohibited card/payment secrets are stored.

## DB-AC-021

Fresh migrations apply successfully in Supabase PostgreSQL.

## DB-AC-022

The schema can support the complete final PayChaos demo without adding an unplanned P0 table.

---

# 50. Phase-to-Table Matrix

| Table | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 |
|---|---|---|---|---|---|
| `orders` | **CREATE** | Use | Use | Use | Stabilize |
| `payment_attempts` | **CREATE** | Add/use Razorpay fields | Use | Use | Stabilize |
| `payments` | — | **CREATE** | Use | Use | Stabilize |
| `fulfilments` | **CREATE** | Link to verified processing | Use | Use | Stabilize |
| `webhook_events` | — | **CREATE** | Use as replay source | Use | Stabilize |
| `event_processing_attempts` | — | **CREATE** | Extend/use chaos evidence | Use | Stabilize |
| `chaos_runs` | — | — | **CREATE** | Use for regression | Stabilize |
| `invariant_results` | — | — | **CREATE** | Use | Stabilize |
| `findings` | — | — | **CREATE** | Add diagnosis/recommendation | Stabilize |
| `regression_runs` | — | — | — | **CREATE** | Stabilize |
| `reliability_score_snapshots` | — | — | — | P1 only | P1 only |

---

# 51. What Each Phase May Assume About the Database

## After Phase 1 Approval

Phase 2 may depend on:

- stable order IDs;
- stable payment-attempt IDs;
- immutable money semantics;
- stable fulfilment business-effect model;
- stable idempotency-key concept;
- RLS/server-only authority.

---

## After Phase 2 Approval

Phase 3 may depend on:

- Razorpay Order correlation;
- Razorpay Payment records;
- canonical real webhook records;
- event-ID deduplication;
- processing-attempt history;
- event provenance;
- fulfilment idempotency.

---

## After Phase 3 Approval

Phase 4 may depend on:

- stable chaos-run IDs;
- stable invariant result history;
- findings;
- evidence references;
- replay/simulation provenance.

---

## After Phase 4 Approval

Phase 5 may depend on:

- regression history;
- finding diagnosis/recommendation state;
- deterministic score inputs.

---

# 52. DATABASE P0 SCHEMA FREEZE

This section defines which database decisions become stable and when.

---

## 52.1 Frozen Before Phase 1

The following database concepts are frozen before implementation begins:

```text
Supabase PostgreSQL
UUID internal identifiers
integer smallest-subunit money
single Demo Merchant workspace
orders as merchant root
payment_attempts separate from payments
fulfilment/business-effect records
verified webhooks as canonical external evidence
processing attempts separate from event identity
database-level webhook deduplication
database-level business idempotency key
real/replay/simulation provenance
append-only invariant results
findings from invariant FAIL only
regression preserving original failures
no secret/card storage
server-only authoritative writes
```

---

## 52.2 Stable After Phase 1 Approval

The following must not be casually changed after Phase 1:

### `orders`

- primary-key semantics;
- amount representation;
- currency representation;
- payment/business state separation.

### `payment_attempts`

- relation to `orders`;
- attempt numbering;
- amount/currency snapshot;
- stable Razorpay receipt concept.

### `fulfilments`

- fulfilment as explicit business-effect evidence;
- stable idempotency-key model.

### Security

- Supabase as the primary database;
- RLS/server-only authoritative mutation model.

Later phases may add the already-approved fields/tables described in this document.

That is not considered redesign.

---

## 52.3 Stable After Phase 2 Approval

The following then become frozen:

```text
payments identity model
razorpay_order_id uniqueness
razorpay_payment_id uniqueness
razorpay_event_id uniqueness
webhook canonical event model
event-processing-attempt model
real-event provenance
business idempotency implementation
```

Phase 3 must consume these rather than redesign them.

---

## 52.4 Stable After Phase 3 Approval

Freeze:

```text
chaos run identity
scenario_id semantics
event replay provenance
invariant result semantics
PASS / FAIL / UNKNOWN
finding relationship
evidence reference model
```

---

## 52.5 Stable After Phase 4 Approval

Freeze:

```text
diagnosis storage
recommendation storage
regression relationship
finding resolution lifecycle
score input semantics
```

---

## 52.6 Changes That Justify Modifying Frozen Schema

A frozen schema may change only for:

1. confirmed correctness bug;
2. confirmed security problem;
3. failed database acceptance criterion;
4. verified Razorpay constraint;
5. verified Supabase/PostgreSQL limitation;
6. incorrect frozen assumption;
7. necessary approved later-phase P0 dependency.

---

## 52.7 Changes That Do NOT Justify Redesign

The following alone are insufficient:

- "another schema looks cleaner";
- preference for more tables;
- preference for fewer tables after implementation is already stable;
- speculative future multi-tenancy;
- hypothetical scale;
- unused P2 features;
- ORM preference.

---

## 52.8 Required Documentation for Frozen Schema Change

Any significant change must record:

```text
Reason
Affected tables
Old design
New design
Data migration impact
Security impact
Idempotency impact
Evidence impact
Affected phases
Tests rerun
Architecture decision reference
```

---

# 53. Explicit P0 Non-Goals

Do not add P0 tables for:

- merchants;
- organizations;
- users;
- teams;
- roles;
- products;
- inventory;
- shopping carts;
- refunds unless separately approved;
- subscriptions;
- payouts;
- settlements;
- invoices;
- AI prompts;
- embeddings;
- vector databases;
- agents;
- model outputs;
- generic audit logs;
- generic event bus;
- queues;
- job scheduler;
- feature flags;
- arbitrary chaos targets.

---

# 54. Final P0 Database Shape

The entire PayChaos database should remain understandable as:

```text
MERCHANT STATE
orders
payment_attempts
payments
fulfilments

EXTERNAL + PROCESSING EVIDENCE
webhook_events
event_processing_attempts

RELIABILITY TESTING
chaos_runs
invariant_results
findings
regression_runs

CURRENT RELIABILITY SCORE
derived from persisted P0 results
```

That is enough for the complete buildathon P0.

---

# DATABASE DEFINITION OF DONE

The database design is ready for implementation only when every item below is true.

## Entity Design

- [ ] every P0 entity has a clear purpose;
- [ ] every P0 table is necessary;
- [ ] unnecessary candidate tables have been removed;
- [ ] relationships are defined.

## Money / Payment

- [ ] money uses integer smallest-subunit values;
- [ ] merchant order state is separate from Razorpay state;
- [ ] payment attempts are separated from Razorpay payments;
- [ ] Razorpay identifiers are defined;
- [ ] payment-state storage supports later captured evidence after failure.

## Idempotency

- [ ] Razorpay Event IDs have a database unique constraint;
- [ ] Razorpay receipts have a unique constraint;
- [ ] Razorpay Order IDs have a unique constraint;
- [ ] Razorpay Payment IDs have a unique constraint;
- [ ] fulfilment idempotency keys have a unique constraint;
- [ ] event identity is separated from processing-attempt identity.

## Webhooks / Evidence

- [ ] real webhook event storage is defined;
- [ ] raw-body integrity hashing is defined;
- [ ] redacted payload storage is defined;
- [ ] duplicate-delivery evidence is defined;
- [ ] replay/simulation provenance is defined;
- [ ] processing before/after state evidence is defined.

## Chaos

- [ ] chaos run storage is defined;
- [ ] fault configuration storage is defined;
- [ ] there is no unsafe global fault table;
- [ ] synthetic demo classification is defined.

## Invariants / Findings

- [ ] PASS/FAIL/UNKNOWN storage is defined;
- [ ] invariant history is immutable;
- [ ] finding creation relationship is defined;
- [ ] evidence references are defined.

## Diagnosis / Regression

- [ ] diagnosis storage is defined;
- [ ] recommendation storage is defined;
- [ ] regression history is defined;
- [ ] original failures remain preserved.

## Reliability

- [ ] P0 current score can be deterministically derived;
- [ ] no unnecessary score table is required;
- [ ] optional P1 score history is separately defined;
- [ ] synthetic runs cannot silently become genuine score inputs.

## Security

- [ ] sensitive-data exclusions are documented;
- [ ] card number is forbidden;
- [ ] CVV is forbidden;
- [ ] Razorpay Key Secret is forbidden;
- [ ] webhook secret is forbidden;
- [ ] Supabase privileged secrets are forbidden;
- [ ] RLS/server authority is defined.

## Supabase Practicality

- [ ] all chosen PostgreSQL types are supported;
- [ ] schema relies on ordinary relational features;
- [ ] no paid database component is required;
- [ ] no unnecessary extensions/infrastructure are required;
- [ ] migrations can be implemented incrementally across the five phases.

## One-Week Practicality

- [ ] P0 contains only 10 domain tables;
- [ ] Phase 1 creates only foundational merchant tables;
- [ ] Phase 2 adds payment/webhook evidence;
- [ ] Phase 3 adds chaos/invariants/findings;
- [ ] Phase 4 adds regression/diagnosis;
- [ ] Phase 5 should not redesign the schema.

When every mandatory item above is satisfied, `DATABASE.md` is considered:

```text
DESIGNED
→ REVIEWED
→ READY FOR PHASE 1 MIGRATION IMPLEMENTATION
```

It does **not** mean the database itself is implemented or Phase 1 has started.