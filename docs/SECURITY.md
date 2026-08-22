# PayChaos AI — Security Model

**Project:** PayChaos AI — Autonomous Payment Reliability Engineer  
**Document Status:** Source-of-truth security specification  
**Environment:** Razorpay Test Mode only  
**Target:** PayChaos-controlled Demo Merchant only  
**Architecture:** Next.js + TypeScript + Supabase PostgreSQL + Razorpay Test Mode  
**Runtime Cost Target:** ₹0  
**Development Constraint:** Approximately one week  
**Security Priority:** P0 / mandatory

---

# 0. Purpose and Authority of This Document

This document defines the complete security model for PayChaos AI.

It governs:

- credentials;
- secrets;
- webhook trust;
- database access;
- authorization;
- authentication;
- chaos-run safety;
- input validation;
- deployment;
- auditability;
- logging;
- AI security;
- source-control security;
- security testing.

It must remain consistent with:

```text
PROJECT_CONTEXT.md
ARCHITECTURE.md
PHASE_PLAN.md
RAZORPAY_GUIDE.md
DATABASE.md
CHAOS_SCENARIOS.md
MONEY_INVARIANTS.md
AI_DESIGN.md
```

For Razorpay-specific behavior:

```text
current official Razorpay documentation
+
RAZORPAY_GUIDE.md
```

remain authoritative.

For database structure:

```text
DATABASE.md
```

remains authoritative.

For money/payment correctness:

```text
MONEY_INVARIANTS.md
```

remains authoritative.

For chaos execution:

```text
CHAOS_SCENARIOS.md
```

remains authoritative.

For AI authority boundaries:

```text
AI_DESIGN.md
```

remains authoritative.

This document adds the detailed security controls needed to implement those existing decisions safely.

---

# 1. Security Goals

PayChaos security has eight primary goals.

## Goal 1 — Prevent Live Payment Execution

PayChaos must never intentionally operate against Razorpay Live Mode.

---

## Goal 2 — Protect Credentials

Secrets must never reach:

- browser bundles;
- public source code;
- Git history;
- logs;
- AI prompts;
- screenshots;
- public error messages.

---

## Goal 3 — Authenticate Payment Evidence

No incoming webhook may become trusted Razorpay evidence until its signature has been verified.

---

## Goal 4 — Prevent Duplicate Money/Business Effects

Duplicate, retried or replayed events must not produce duplicate fulfilment.

---

## Goal 5 — Contain Chaos

Chaos must remain limited to:

```text
approved scenario
+
registered Demo Merchant
+
approved internal fault primitive
```

---

## Goal 6 — Protect Authoritative State

Browser code must not directly control:

- payment state;
- fulfilment state;
- webhook evidence;
- invariant results;
- findings;
- reliability results.

---

## Goal 7 — Preserve Evidence Integrity

Recorded evidence must remain distinguishable from:

- replay;
- simulation;
- fixture data;
- AI inference.

---

## Goal 8 — Fail Closed

Security uncertainty must lead to:

```text
REJECT
BLOCKED
ERROR
UNKNOWN
```

as appropriate.

Never silently continue when a critical security boundary cannot be established.

---

# 2. Security Boundaries

PayChaos has five main security boundaries.

```text
UNTRUSTED
Browser / Internet
       │
       ▼
────────────────────────────
NEXT.JS SERVER TRUST BOUNDARY
────────────────────────────
       │
       ├── Razorpay Adapter
       ├── Webhook Verification
       ├── Event Processor
       ├── Chaos Safety Gate
       ├── Invariant Engine
       └── Database Access
       │
       ▼
────────────────────────────
SUPABASE DATABASE BOUNDARY
────────────────────────────

External trusted provider after verification:
Razorpay Test Mode

Optional advisory boundary:
ML / Ollama
```

The browser is never an authoritative payment-security boundary.

---

# 3. Assets That Must Be Protected

Important assets include:

## Credentials

```text
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
SUPABASE_SERVICE_ROLE_KEY
PAYCHAOS_ACCESS_TOKEN
PAYCHAOS_SESSION_SECRET
```

---

## Payment Evidence

- Razorpay Order IDs;
- Razorpay Payment IDs;
- webhook event IDs;
- verified payment states;
- amount/currency evidence;
- webhook integrity hashes.

---

## Merchant State

- order payment state;
- business state;
- fulfilment history;
- payment correlation.

---

## Reliability Evidence

- chaos runs;
- processing attempts;
- invariant results;
- findings;
- regression results.

---

## Security Configuration

- Test Mode configuration;
- scenario registry;
- fault registry;
- target restrictions;
- access-gate configuration.

---

# 4. Trust Boundaries

## Browser

**Trust level:** Untrusted.

Browser input must be validated.

The browser cannot authoritatively decide:

- payment success;
- payment amount;
- fulfilment;
- webhook authenticity;
- invariant outcome.

---

## Next.js Server

**Trust level:** Trusted application boundary.

Owns:

- private credentials;
- validation;
- Razorpay API access;
- payment verification;
- webhook verification;
- authoritative database mutation;
- chaos authorization.

---

## Supabase PostgreSQL

**Trust level:** Trusted durable state.

Database constraints protect:

- relationships;
- unique identifiers;
- idempotency boundaries;
- status validity.

---

## Razorpay Test Mode

**Trust level:** External provider whose API responses and webhook evidence are trusted only through the relevant authenticated/verified server channel.

---

## Optional AI / ML

**Trust level:** Advisory only.

It receives sanitized evidence and has no payment authority.

---

# 5. Threat Actors

The practical threat model considers:

## TA-01 — Accidental Developer Misconfiguration

Examples:

- Live key pasted accidentally;
- secret added to source;
- wrong webhook secret;
- wrong Vercel environment.

---

## TA-02 — Unauthorized Internet User

May try to:

- start chaos;
- reset demo data;
- create large numbers of Test Mode orders;
- invoke internal APIs.

---

## TA-03 — Forged Webhook Sender

May send payment-looking JSON to the public webhook route.

---

## TA-04 — Malicious Browser Input

May modify:

- amount;
- IDs;
- scenario identifiers;
- status values;
- target information.

---

## TA-05 — Source-Code / Repository Observer

May inspect GitHub for accidentally committed credentials.

---

## TA-06 — Compromised Dependency

A vulnerable runtime dependency may expose server behavior.

---

## TA-07 — Prompt-Injection Content

If an optional LLM is enabled, evidence text may attempt to influence model instructions.

---

## TA-08 — Accidental CI / Deployment Disclosure

Secrets may appear in:

- CI logs;
- build output;
- environment dumps;
- screenshots.

---

# 6. Attack Surface

The P0 attack surface includes:

- public web application;
- Demo Merchant UI;
- payment-creation endpoint;
- Checkout verification endpoint;
- Razorpay webhook endpoint;
- chaos start endpoint;
- regression endpoint;
- Demo Reset operation;
- read-only dashboard APIs;
- Supabase API;
- Vercel configuration;
- GitHub repository;
- dependency supply chain;
- optional Ollama interface if P2 is added.

The security objective is to keep this surface small.

---

## 6.1 Practical Threat Model

| Threat | Likelihood | Impact | Primary Control |
|---|---|---|---|
| Credential exposure | Medium | Critical | Server-only secrets |
| Forged webhook | Medium | Critical | HMAC raw-body verification |
| Duplicate processing | High | Critical | DB + business idempotency |
| Unauthorized chaos | Medium | High | Operator access gate |
| Live Mode mistake | Medium | Critical | Test-mode fail-closed checks |
| Arbitrary targeting | Low | Critical | Static server registry |
| Sensitive logging | Medium | High | Structured redaction |
| Database misuse | Medium | Critical | RLS + server-only privileged writes |
| Malformed request | High | High | Schema validation |
| AI authority escalation | Low | Critical | Read-only advisory boundary |

---

# ABSOLUTE SECURITY RULES

The following rules are non-negotiable.

1. Razorpay Test Mode only.
2. Never store card number/PAN.
3. Never store CVV.
4. Never store card PIN or OTP.
5. Never expose the Razorpay Key Secret.
6. Never expose the Razorpay webhook secret.
7. Never expose the Supabase service-role key to browser code.
8. Never commit `.env` files containing credentials.
9. Never target arbitrary external systems.
10. Chaos executes only against the registered Demo Merchant.
11. Invalid webhook signatures cause zero business-state mutation.
12. Browser payment success is never authoritative by itself.
13. Database constraints must protect event and business idempotency.
14. AI cannot override deterministic payment state.
15. AI cannot override Money Invariants.
16. No real customer payment data is required or permitted.
17. Replay must never be labelled as a newly generated Razorpay webhook.
18. PayChaos-controlled faults must never be described as Razorpay faults.
19. Security failures must fail closed.
20. No P0 feature may require a paid security service.

---

# 7. Razorpay Credential Security

Razorpay uses:

```text
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
```

The Key ID may be sent to the browser only because Standard Checkout requires it.

The Key Secret must remain server-side.

The webhook secret must remain server-side.

The Key Secret and webhook secret must never be the same value.

---

## Credential Rule RZP-CRED-001

`RAZORPAY_KEY_SECRET` must never use a:

```text
NEXT_PUBLIC_
```

prefix.

---

## Credential Rule RZP-CRED-002

`RAZORPAY_WEBHOOK_SECRET` must never use a:

```text
NEXT_PUBLIC_
```

prefix.

---

## Credential Rule RZP-CRED-003

If:

```text
RAZORPAY_KEY_ID
```

starts with:

```text
rzp_live_
```

the application must fail closed.

---

# 8. Supabase Credential Security

PayChaos distinguishes:

```text
client-safe Supabase credentials
```

from:

```text
privileged server credentials
```

The Supabase anonymous/client key depends on RLS for safety.

The service-role key bypasses normal RLS protections and is therefore a critical server secret.

It must never reach browser code.

---

# 9. Environment-Variable Rules

Environment-variable handling must follow these rules.

## ENV-001

Real secret values live in:

```text
.env.local
```

for local development.

---

## ENV-002

Real deployment secrets live in Vercel environment-variable configuration.

---

## ENV-003

`.env.local` must not be committed.

---

## ENV-004

`.env.example` contains only:

- variable names;
- non-secret example values;
- explanatory placeholders.

---

## ENV-005

Do not print the environment configuration object to logs.

---

## ENV-006

Application startup/config validation should fail when required server secrets are missing.

---

## ENV-007

A configuration failure must not display the missing/invalid secret value.

---

# SECRET CLASSIFICATION

| Variable | Client-safe? | Server-only? | Secret? | Commit actual value to GitHub? | Storage |
|---|---:|---:|---:|---:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | No | No | Prefer **No** for project-specific value | `.env.local`, Vercel client env |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes, with RLS | No | No privileged authority | Prefer **No** for project-specific value | `.env.local`, Vercel client env |
| `SUPABASE_SERVICE_ROLE_KEY` | **No** | **Yes** | **Yes — Critical** | **Never** | `.env.local`, Vercel server env |
| `RAZORPAY_KEY_ID` | Checkout-safe | Server also uses | No | Do not commit actual value | `.env.local`, Vercel env |
| `RAZORPAY_KEY_SECRET` | **No** | **Yes** | **Yes — Critical** | **Never** | `.env.local`, Vercel server env |
| `RAZORPAY_WEBHOOK_SECRET` | **No** | **Yes** | **Yes — Critical** | **Never** | `.env.local`, Vercel server env |
| `RAZORPAY_MODE` | Yes if displayed | Yes | No | `test` may appear in `.env.example` | `.env.local`, Vercel |
| `PAYCHAOS_ACCESS_GATE` | Yes conceptually | Yes | No | Example may be committed | `.env.local`, Vercel |
| `PAYCHAOS_ACCESS_TOKEN` | **No** | **Yes** | **Yes** | **Never** | `.env.local`, Vercel server env |
| `PAYCHAOS_SESSION_SECRET` | **No** | **Yes** | **Yes** | **Never** | `.env.local`, Vercel server env |

Client-safe does not mean an actual project-specific value must be committed to Git.

---

# 10. Client-Safe vs Server-Only Secrets

## Client-Safe

May include:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
Razorpay Test Key ID
Razorpay order_id
amount
currency
safe display data
```

---

## Server-Only

Must include:

```text
SUPABASE_SERVICE_ROLE_KEY
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
PAYCHAOS_ACCESS_TOKEN
PAYCHAOS_SESSION_SECRET
```

Any server-only variable accidentally imported into a browser/client module is a security defect.

---

# 11. Webhook Signature Verification Security

The public webhook route is:

```text
POST /api/webhooks/razorpay
```

The endpoint does not use the normal user-session access gate.

Instead it is authenticated using Razorpay's webhook signature.

Required process:

```text
HTTP request
→ raw request body
→ X-Razorpay-Signature
→ webhook secret
→ HMAC verification
→ parse JSON only after success
→ validation
→ persistence
→ processing
```

---

## Invalid Signature Rule

If signature verification fails:

```text
NO webhook_events trusted row
NO payment mutation
NO order mutation
NO fulfilment
NO trusted event processing
```

Security/operational logging may occur.

---

# 12. Raw-Body Verification Requirement

The exact body received by the server must be used for HMAC verification.

Forbidden sequence:

```text
JSON parse
→ JSON stringify
→ signature verification
```

Required:

```text
read raw bytes/string
→ verify signature
→ then parse
```

Any refactor that changes this sequence requires a webhook security regression test.

---

# 13. Webhook Replay Protection

PayChaos has two forms of replay to distinguish.

## External Duplicate Delivery

A real Razorpay webhook with the same:

```text
x-razorpay-event-id
```

is recognized as the same canonical event.

---

## Internal PayChaos Replay

PayChaos deliberately processes stored verified evidence again.

It must be labelled:

```text
PAYCHAOS_REPLAY
```

and must not re-enter through the external webhook-authentication boundary pretending to be Razorpay.

---

## Replay Rule

Replaying a processed event must not change protected final business state.

---

# 14. Idempotency Protection

PayChaos requires multiple independent idempotency controls.

## Layer 1 — Razorpay Order Correlation

Stable:

```text
razorpay_receipt
```

protects against accidental duplicate Order creation behavior.

---

## Layer 2 — External Webhook Identity

Database uniqueness on:

```text
razorpay_event_id
```

prevents duplicate canonical external events.

---

## Layer 3 — Business Effect

Stable semantic:

```text
fulfilments.idempotency_key
```

prevents duplicate fulfilment.

---

## Important Security Rule

Webhook deduplication alone is not sufficient.

Two different valid events must still not create two equivalent merchant business effects.

---

# 15. Duplicate Event Handling

Duplicate real webhook delivery is not automatically malicious.

It must be handled safely.

Required behavior:

1. verify the duplicate request's signature;
2. inspect event ID;
3. detect existing canonical event;
4. record duplicate-delivery evidence where appropriate;
5. do not create duplicate canonical event;
6. do not repeat protected business effect;
7. return a safe success response when appropriate.

Database uniqueness is the final race-safety boundary.

---

# 16. Authorization Requirements

P0 is a:

```text
single controlled buildathon workspace
```

not a multi-tenant system.

There are only two security actor classes that need runtime access.

## Operator

May:

- create Demo Merchant test orders;
- run Test Mode payments;
- start chaos runs;
- run regressions;
- reset demo state;
- inspect evidence.

---

## Razorpay Webhook Sender

May only access:

```text
POST /api/webhooks/razorpay
```

and is authorized by valid webhook signature.

---

## No P0 Roles

Do not create:

- organization roles;
- merchant roles;
- admin tables;
- team membership;
- RBAC database schema.

---

# 17. Authentication Requirements

A full account/login system is not required.

However, a publicly deployed buildathon instance must not expose chaos controls anonymously.

Therefore P0 uses a **minimal single-workspace access gate**.

---

## P0 Access Gate

Recommended model:

```text
operator enters high-entropy access token
        ↓
server verifies token
        ↓
server establishes signed HttpOnly session
        ↓
privileged PayChaos routes require that session
```

No user record is required.

---

## Session Requirements

Session cookie should be:

```text
HttpOnly
Secure in HTTPS deployment
SameSite=Strict or Lax as compatible
short-lived/reasonable demo lifetime
signed server-side
```

Do not store the access token in:

```text
localStorage
```

---

## Local Development

The access gate may be disabled only for trusted local development.

A public Vercel deployment must enable it.

The webhook path is always exempt from operator login because Razorpay needs external access.

---

# 18. Chaos-Run Authorization

Before starting chaos, server logic must establish:

```text
authorized operator
+
approved scenario
+
approved internal target
+
approved fault primitive
+
Test Mode environment
```

A browser button itself is not authorization.

---

## Required Server Authorization

The server must independently validate:

```text
scenario_id
target
fault_type
source event
operator session
```

Do not trust hidden form fields.

---

## Fault Controls

There must be no separate public API such as:

```text
/enable-bug
/disable-idempotency
/fail-database
```

available without the Chaos Runner security boundary.

Fault behavior belongs behind the controlled scenario execution path.

---

# 19. Test-Environment-Only Enforcement

Test Mode safety must use multiple controls.

## Control 1

```text
RAZORPAY_MODE=test
```

must be required.

---

## Control 2

Key ID must represent Test Mode.

```text
rzp_test_...
```

accepted.

```text
rzp_live_...
```

rejected.

---

## Control 3

No application UI allows switching to Live Mode.

---

## Control 4

Chaos preflight checks Test Mode again.

---

## Control 5

Relevant UI displays:

```text
RAZORPAY TEST MODE
```

---

## Control 6

Deployment environment name such as:

```text
production
```

on Vercel must never imply Razorpay Live Mode.

Hosting production and payment Live Mode are separate concepts.

---

# 20. Protection Against Arbitrary Endpoint Targeting

PayChaos is not a generic chaos platform.

The API must not accept user-controlled:

```text
url
host
hostname
ip
webhook_url
callback_url
target_endpoint
```

for chaos execution.

Chaos requests should contain only controlled identifiers such as:

```text
scenario_id
order_id
payment_attempt_id
source_webhook_event_id
```

The target is resolved server-side to the known Demo Merchant processing boundary.

---

## SSRF Rule

PayChaos chaos functionality must not perform HTTP requests to user-supplied destinations.

This removes an entire SSRF/abuse class from P0.

---

# 21. Demo Merchant Restrictions

The Demo Merchant must remain intentionally narrow.

It must not store:

- customer accounts;
- real user profiles;
- shipping addresses;
- real email addresses;
- real phone numbers;
- real banking details.

The merchant exists only to expose:

- order state;
- payment state;
- fulfilment state.

---

## Fault Isolation

Fault configuration must belong to one:

```text
chaos_runs
```

record.

No persistent global fault setting may remain enabled after a run.

---

## Cleanup

Chaos cleanup should execute after:

```text
PASS
FAIL
ERROR
```

where technically possible.

---

# 22. Input Validation

All externally supplied input is untrusted.

Required validation includes:

## IDs

Internal IDs must be valid UUIDs where applicable.

---

## Scenario IDs

Must belong to the static approved registry.

---

## Amounts

Must be:

- integer;
- positive;
- in smallest currency unit;
- determined/confirmed server-side.

Never trust browser-submitted payment amount as authoritative.

---

## Currency

P0 supports the approved Demo Merchant currency.

Default:

```text
INR
```

Unexpected currency values must be rejected.

---

## Status Values

Browser requests must not be able to supply authoritative status such as:

```text
PAID
FULFILLED
CAPTURED
```

and have it applied directly.

---

## Request Size

P0 routes must enforce bounded request sizes.

A practical PayChaos application limit may be set around:

```text
1 MiB
```

for supported JSON/webhook requests after confirming that real P0 Razorpay Test Mode payloads remain comfortably below it.

This is a PayChaos application defense, not a claimed Razorpay platform limit.

---

# 23. API Validation

Each mutation route must validate:

```text
authentication/authorization
content type
request schema
identifier format
domain existence
allowed state
allowed scenario
allowed provenance
```

before authoritative mutation.

---

## Checkout Verification

The server must load the trusted order correlation from its own database.

It must not trust a browser-provided order relationship.

---

## Chaos Request

The server must resolve fault behavior from:

```text
scenario registry
```

not from arbitrary client parameters.

---

## Regression Request

Regression must reference an existing Finding and approved original scenario.

---

# 24. Database Security

Supabase PostgreSQL protects authoritative state through:

- RLS;
- foreign keys;
- unique constraints;
- check constraints;
- transactions.

Important integrity boundaries must not exist only in React or route-handler code.

---

## Database Authority Rule

Authoritative writes occur through trusted Next.js server code.

The browser must not directly mutate payment/evidence/reliability tables.

---

# 25. Row Level Security Requirements

RLS must be enabled on all P0 application tables.

P0 tables:

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

---

## Default Browser Policy

For anonymous/unprivileged browser access:

```text
INSERT = denied
UPDATE = denied
DELETE = denied
```

`SELECT` should also be denied by default unless an explicit read-only requirement is approved.

P0 should prefer server-mediated reads.

---

## Trusted Server

The trusted server may use the Supabase privileged credential for operations requiring authoritative access.

Because that credential bypasses normal client RLS protections:

```text
SUPABASE_SERVICE_ROLE_KEY
```

is a critical secret.

---

## RLS Test Requirement

Attempt direct anon/client:

```text
INSERT
UPDATE
DELETE
```

against authoritative tables.

Expected:

```text
DENIED
```

---

# 26. SQL Injection Protection

P0 should use:

- Supabase SDK/query builder;
- parameterized SQL;
- fixed migrations;
- fixed stored functions where needed.

Never construct SQL by concatenating browser input.

Forbidden chaos feature:

```text
execute arbitrary SQL
```

If raw SQL is required in a migration, all dynamic values must be controlled migration constants, not request data.

---

# 27. XSS Protection

React/Next.js escaping is the default presentation boundary.

Security rules:

- do not render untrusted webhook text using `dangerouslySetInnerHTML`;
- do not inject raw AI output as HTML;
- escape/safely render error descriptions;
- sanitize any future Markdown rendering;
- avoid displaying complete unredacted webhook payloads.

AI explanation output is plain text/structured UI content by default.

---

## Content Security Policy

A CSP is desirable for Phase 5 hardening but must be tested carefully with Razorpay Standard Checkout.

Do not deploy a restrictive CSP that breaks Checkout merely to claim a security feature.

If CSP is implemented:

- whitelist only required origins;
- test Checkout manually;
- document exceptions.

---

# 28. CSRF Considerations

Cookie-authenticated state-changing routes require CSRF consideration.

P0 protections:

- mutation endpoints use POST or appropriate non-GET methods;
- operator cookie uses SameSite protection;
- privileged routes validate request Origin/Host where practical;
- cross-origin form/API submissions must be rejected.

Do not expose state mutation through GET requests.

---

## Webhook Exception

The Razorpay webhook is not browser/session authenticated.

Therefore normal CSRF checks must not block it.

Its security boundary is:

```text
webhook signature verification
```

---

# 29. CORS Considerations

Privileged PayChaos APIs are same-origin.

Do not configure:

```text
Access-Control-Allow-Origin: *
```

for privileged mutation routes.

The webhook route does not need browser CORS permission because Razorpay performs server-to-server requests.

Any future cross-origin API requirement requires security review.

---

# 30. Sensitive-Data Handling

PayChaos must never intentionally store:

```text
PAN / card number
CVV
card PIN
OTP
raw card credential
real banking password
real customer banking credential
Razorpay Key Secret
webhook secret
Supabase service-role key
```

Avoid unnecessary persistence of:

- customer email;
- customer phone;
- VPA/UPI identity;
- payment-instrument details.

---

## Razorpay Checkout

Sensitive payment entry belongs inside Razorpay's payment experience.

PayChaos should not create its own card-entry form.

---

# 31. Logging and Redaction Rules

Logs should be structured.

Allowed examples:

```text
event_name
request_id
merchant_order_id
payment_attempt_id
razorpay_order_id
razorpay_payment_id
razorpay_event_id
chaos_run_id
invariant_id
finding_id
status
signature_verified
duplicate_detected
latency_ms
safe error code
```

---

## Never Log

```text
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
SUPABASE_SERVICE_ROLE_KEY
PAYCHAOS_ACCESS_TOKEN
PAYCHAOS_SESSION_SECRET
full card data
CVV
OTP
full unredacted webhook payload
Checkout signature unnecessarily
full auth/session cookie
```

---

## Redacted Webhook Evidence

The database may retain:

```text
raw_body_sha256
raw_payload_redacted
```

according to `DATABASE.md`.

The integrity hash is evidence.

The raw sensitive body should not be casually copied to application logs.

---

# 32. Audit Logging

P0 does not create a generic:

```text
audit_events
```

table.

The durable audit trail is reconstructed from domain records:

```text
webhook_events
event_processing_attempts
fulfilments
chaos_runs
invariant_results
findings
regression_runs
```

Structured server logs supplement this.

---

## Required Audit Questions

The system should be able to answer:

- which scenario ran;
- which order/payment was targeted;
- which event was replayed;
- what provenance it had;
- what fault was activated;
- which processing attempts occurred;
- what invariant evaluated;
- what finding resulted;
- when regression occurred.

---

## Access-Gate Audit

P0 may record safe structured logs such as:

```text
ACCESS_GRANTED
ACCESS_DENIED
CHAOS_AUTHORIZED
CHAOS_BLOCKED
```

Do not log the access token.

---

# 33. Rate Limiting

P0 must remain zero-cost.

Therefore the project must not add a paid rate-limiting service.

---

## Primary P0 Abuse Controls

1. operator access gate;
2. server-side validation;
3. one controlled Demo Merchant;
4. approved scenario registry;
5. database uniqueness;
6. one active chaos run per controlled target/workspace where practical;
7. Razorpay API 429 backoff;
8. request-size bounds.

---

## Important Limitation

A fully distributed Internet-scale rate limiter normally requires shared state.

P0 does not add Redis or another paid/distributed rate-limit store solely for this purpose.

Therefore P0 must not claim enterprise-grade distributed rate limiting.

If PayChaos is later opened for anonymous multi-user use:

a durable rate-limiting design becomes mandatory.

---

# 34. Abuse Prevention

The strongest abuse prevention is capability restriction.

Users cannot provide:

- arbitrary targets;
- arbitrary scripts;
- arbitrary SQL;
- arbitrary webhook destinations;
- arbitrary commands.

Chaos is defined entirely by a static server-side catalogue.

---

## Payment Abuse

The deployed access gate should protect Test Mode payment creation from unrestricted public automation.

---

## Concurrent Chaos

Starting overlapping incompatible chaos runs should be rejected.

This avoids one scenario's fault state contaminating another scenario.

---

# 35. Error-Message Security

Client-facing errors should contain:

```text
safe error code
short safe message
correlation/request ID where useful
```

Example:

```text
CONFIGURATION_ERROR
Required server configuration is unavailable.
```

Never return:

```text
RAZORPAY_KEY_SECRET missing: sk_...
```

---

## Stack Traces

Do not return server stack traces to browser users in deployed environments.

Detailed internal traces may remain in server logs if they contain no secrets.

---

## Database Errors

Do not expose:

- database connection strings;
- service credentials;
- raw SQL;
- internal policy definitions

through public error responses.

---

# 36. Dependency Security

P0 should keep dependencies minimal.

Required practices:

- commit the package-manager lockfile;
- avoid unnecessary runtime packages;
- use maintained official SDKs where practical;
- run dependency security audit before final deployment;
- review critical/high-severity runtime findings;
- update vulnerable dependencies with regression testing.

---

## Optional Free Tooling

If useful without delaying P0:

- GitHub Dependabot;
- GitHub dependency alerts;
- CodeQL where available;
- local package-manager audit.

These are security enhancements, not excuses to delay core payment testing.

---

# 37. Git / GitHub Secret Protection

Required:

```text
.env
.env.local
.env.*.local
```

containing real secrets must be ignored.

`.env.example` must contain no real credentials.

---

## Before Every Push Containing Configuration Changes

Check:

```text
git status
git diff
```

and search for accidental secrets.

Search for patterns such as:

```text
rzp_test_
rzp_live_
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
service_role
SUPABASE_SERVICE_ROLE_KEY
```

The presence of a variable name is normal.

The presence of a real secret value is not.

---

## Secret Leak Response

If a secret reaches Git:

**deleting it from the newest file is not enough.**

Treat the secret as compromised and rotate/revoke it.

---

# 38. CI/CD Secret Protection

P0 should not require real Razorpay credentials for ordinary automated unit tests.

Use:

- sanitized fixtures;
- fake test-only secrets;
- deterministic signature fixtures.

Real Razorpay Test Mode integration is manually verified separately.

---

## If CI Secrets Are Used

They must live in GitHub/Vercel secret storage.

Never:

- echo them;
- print full environment;
- include them in test snapshots;
- include them in uploaded build artifacts.

---

## Pull Request Safety

Do not expose privileged secrets automatically to untrusted forked pull-request code.

For this single-developer buildathon project, the simplest safe model is:

```text
ordinary CI uses no real payment secrets
```

---

# 39. Deployment Security

Final deployment uses:

```text
Vercel
+
Supabase
+
Razorpay Test Mode
```

---

## Required Deployment Controls

- HTTPS;
- Razorpay Test Mode environment variables;
- no Live credentials;
- operator access gate enabled;
- service-role key server-only;
- webhook endpoint public;
- webhook signature mandatory;
- Test Mode banner visible;
- no debug secret output;
- RLS enabled;
- final security tests passed.

---

## Preview Deployments

Preview deployments must also use Test Mode only.

Do not place Live credentials in preview configuration.

---

## Environment Changes

After credential rotation/change:

- update secure deployment variables;
- redeploy where required;
- rerun critical payment/webhook verification.

---

# 40. AI / LLM Security Boundaries

P0 does not require an LLM.

Deterministic diagnosis remains the default.

If ML or Ollama is introduced:

it remains downstream of the Finding.

---

## AI Has No Mutation Authority

AI must not have code paths capable of directly mutating:

```text
orders
payments
fulfilments
webhook_events
invariant_results
chaos safety configuration
```

---

## AI Receives Sanitized Evidence

Inputs should use whitelisted values such as:

```text
event_type
source_kind
statuses
counts
timestamps
invariant ID
invariant result
state before/after
```

Do not pass secrets or full raw webhook payloads.

---

# 41. Prompt-Injection Considerations

Prompt injection applies only if optional free-form LLM capability is added.

All evidence must be treated as untrusted data.

---

## PI-001 — No Tool Access

The LLM receives no tools capable of:

- network requests;
- database writes;
- shell execution;
- code deployment;
- payment mutation;
- chaos execution.

---

## PI-002 — Evidence Is Data

Text found in evidence such as:

```text
Ignore previous instructions
```

must be treated as literal evidence content.

---

## PI-003 — Whitelisted Input

Only required structured evidence fields may be passed.

---

## PI-004 — Validate Output

Root-cause and recommendation codes must belong to the approved catalogues.

Unknown values are rejected.

---

## PI-005 — No Authority Escalation

LLM output such as:

```text
mark this payment PAID
```

has no execution path.

---

## PI-006 — Safe Fallback

Invalid/unavailable AI output returns to deterministic template explanation.

---

# 42. Security Testing

Security testing is mandatory.

Required categories:

```text
configuration tests
secret-boundary tests
webhook-authentication tests
database-authorization tests
input-validation tests
idempotency tests
chaos-authorization tests
provenance tests
AI-isolation tests
deployment checks
```

Security tests must actually be executed.

Do not mark security complete because tests merely exist.

---

# SECURITY PRE-FLIGHT CHECK

Every chaos run must perform security preflight before fault injection.

Required checks:

```text
PRE-SEC-001 Environment is TEST
PRE-SEC-002 Razorpay Key ID is Test Mode
PRE-SEC-003 No Live Razorpay credential detected
PRE-SEC-004 Target is registered Demo Merchant
PRE-SEC-005 Scenario exists in approved registry
PRE-SEC-006 Fault primitive is approved
PRE-SEC-007 Required server secrets exist
PRE-SEC-008 Database is reachable
PRE-SEC-009 Required verified fixture/evidence exists
PRE-SEC-010 Operator/session is authorized when access gate is enabled
PRE-SEC-011 Audit/evidence recording path is available
PRE-SEC-012 No arbitrary external target is present
```

If any **critical** preflight check fails:

```text
CHAOS RUN = BLOCKED
```

and:

```text
NO FAULT INJECTION
NO REPLAY
NO PAYMENT MUTATION
NO EXTERNAL CHAOS CALL
```

may occur.

---

# SECURITY TEST MATRIX

| Test | Expected Result |
|---|---|
| Valid Razorpay webhook signature | Event may enter trusted processing |
| Invalid webhook signature | Rejected; zero business mutation |
| Missing webhook signature | Rejected; zero business mutation |
| Modified raw body with old signature | Rejected |
| Replay of processed event | Protected final business state unchanged |
| Duplicate external event ID | One canonical webhook row only |
| Duplicate fulfilment attempt | DB/business idempotency prevents healthy duplicate |
| Unauthorized chaos request | 401/403-style rejection; no chaos run starts |
| Invalid scenario ID | `BLOCKED` / validation rejection |
| Arbitrary target URL supplied | Rejected |
| `rzp_live_` key configured | Application/operation fails closed |
| Missing Key Secret | Razorpay operation unavailable; no secret printed |
| Missing webhook secret | Webhook trust unavailable; no processing |
| Service-role key referenced from client | Build/test must fail review |
| Browser direct authoritative DB write | RLS denies |
| Malformed UUID | Validation failure; zero mutation |
| Negative/zero amount | Rejected |
| Unsupported currency | Rejected |
| Client attempts `PAID` state mutation | Rejected/ignored |
| Unsafe AI says "mark PAID" | No state mutation |
| AI unavailable | Invariants/scoring continue |
| Cross-origin privileged mutation | Rejected |
| Raw HTML/error payload | Rendered safely; no XSS |
| Secret string passed to logger test | Redacted/not emitted |
| Concurrent duplicate event insertion | Unique constraint prevents second canonical row |

---

# 43. Manual Security Verification

Before final approval, the developer must manually verify:

## Credentials

- [ ] no real secret exists in tracked Git files;
- [ ] no `.env.local` is committed;
- [ ] browser bundle does not expose server secrets;
- [ ] DevTools does not show Key Secret;
- [ ] DevTools does not show webhook secret;
- [ ] DevTools does not show Supabase service-role key.

## Test Mode

- [ ] Razorpay Dashboard is in Test Mode;
- [ ] configured Key ID is `rzp_test_...`;
- [ ] no Live Mode UI exists;
- [ ] deployed UI says Razorpay Test Mode.

## Webhooks

- [ ] real valid webhook works;
- [ ] invalid-signature test causes zero mutation;
- [ ] duplicate event remains idempotent.

## Database

- [ ] RLS enabled;
- [ ] anon direct mutation fails;
- [ ] trusted server operation succeeds;
- [ ] service-role secret appears nowhere in browser.

## Chaos

- [ ] logged-out/unauthorized chaos request fails on deployed app;
- [ ] arbitrary target cannot be supplied;
- [ ] only registered scenario can execute;
- [ ] fault is disabled after test.

## AI

- [ ] AI/diagnosis cannot set payment state;
- [ ] AI/diagnosis cannot change invariant result;
- [ ] synthetic/replayed evidence is visibly labelled.

## Logs

- [ ] no secret is visible;
- [ ] no raw card/CVV data exists;
- [ ] errors are safely redacted.

---

# 44. Incident / Failure Handling

Security failures must result in containment first.

---

## Secret Exposure

If a Razorpay Key Secret is exposed:

1. stop using the compromised credential;
2. rotate/regenerate the Test Mode key;
3. update local secure configuration;
4. update Vercel environment configuration;
5. redeploy;
6. verify Checkout/order creation;
7. inspect Git history/logs for exposure source.

---

## Webhook Secret Exposure

1. treat secret as compromised;
2. generate/configure a replacement;
3. update Razorpay Test Mode webhook configuration;
4. update server environment;
5. redeploy;
6. rerun webhook verification.

If old Razorpay retries may interact with secret rotation, verify the latest Razorpay documentation before implementing multi-secret compatibility.

---

## Supabase Service-Role Exposure

1. treat the key as compromised;
2. rotate/revoke through supported Supabase controls;
3. update server environment;
4. redeploy;
5. verify RLS;
6. inspect database for unexpected changes.

---

## Live Credential Detected

Immediately:

```text
disable Razorpay operations
disable chaos
display configuration failure
```

Do not attempt a "safe test" with the Live credential.

---

## Unexpected Business Mutation

If a security test produces unauthorized payment/business mutation:

- preserve evidence;
- stop affected chaos testing;
- classify as blocking P0 security issue;
- fix;
- rerun relevant regression;
- only then continue.

---

# 45. Known Limitations

P0 intentionally does not provide enterprise security architecture.

Known limitations include:

## No Full IAM

There are no:

- users table;
- teams;
- organizations;
- per-user roles;
- enterprise RBAC;
- SSO.

---

## Shared Operator Access

The deployment access gate represents one controlled operator role.

It does not provide per-user audit identity.

---

## No Enterprise Distributed Rate Limiter

P0 relies on:

- access restriction;
- capability restriction;
- provider limits;
- application validation.

---

## No WAF Requirement

A paid or dedicated Web Application Firewall is not required for P0.

---

## No SIEM

Structured logs and database evidence are sufficient for the buildathon.

---

## No Production Security Claim

PayChaos is a Test Mode reliability-testing project.

The security design does not constitute:

- PCI certification;
- penetration-test certification;
- production-readiness certification;
- Razorpay certification.

---

## Single Workspace

P0 does not provide tenant isolation because multi-tenancy is out of scope.

---

# 46. P0 / P1 / P2 Security Requirements

## P0 — Mandatory

P0 must include:

```text
Test Mode enforcement
secret separation
RLS
server-only authoritative writes
webhook signature verification
raw-body verification
database event deduplication
business-effect idempotency
static chaos target
scenario allowlist
chaos security preflight
minimal deployed access gate
input validation
error redaction
safe logs
Git secret protection
AI non-authority
security tests
manual verification
```

---

## P1 — Hardening

Only after P0 is stable:

- dependency automation;
- stronger security headers;
- CSP tested with Razorpay;
- more detailed access/audit information;
- enhanced automated secret scanning;
- improved rate limiting if exposure requires it;
- optional model security tests if ML is added.

---

## P2 — Stretch

Potential future security improvements:

- individual user accounts;
- MFA;
- real RBAC;
- per-user audit identity;
- distributed rate limiting;
- dedicated WAF;
- external security monitoring;
- richer security analytics.

None is required for buildathon P0.

---

# 47. Phase Mapping

## Phase 1 — Foundation + Demo Merchant

Implement security foundation:

```text
environment validation
server/client credential separation
Supabase RLS
service-role server-only boundary
safe logging conventions
input-validation foundation
Git secret exclusions
```

Phase 1 security cannot be postponed completely to Phase 5.

---

## Phase 2 — Razorpay + Webhooks

Implement:

```text
Test Mode validation
Razorpay secret handling
Checkout server verification
raw-body webhook verification
webhook HMAC verification
event deduplication
business idempotency
safe webhook errors
no card/CVV storage
```

A real webhook must be manually verified.

---

## Phase 3 — Chaos + Invariants

Implement:

```text
scenario registry
target restriction
fault allowlist
chaos preflight
operator authorization boundary
replay provenance
fault cleanup
no arbitrary URL/script/SQL
```

Security tests must prove chaos cannot escape the controlled Demo Merchant.

---

## Phase 4 — Diagnosis + AI

Implement:

```text
evidence sanitization
AI read-only authority
no mutation tools
template fallback
prompt-injection protection if LLM exists
AI output validation
```

P0 AI remains deterministic.

---

## Phase 5 — Final Hardening

Perform:

```text
deployed access-gate verification
security headers where compatible
dependency audit
Git secret review
browser bundle inspection
RLS tests
complete security regression suite
deployment environment review
manual security checklist
```

Phase 5 hardens existing architecture.

It must not be used to excuse missing security boundaries from Phases 1–4.

---

# THREAT REGISTER

# SEC-001 — Razorpay Key Secret Leaked to Browser

**Description:**  
`RAZORPAY_KEY_SECRET` is accidentally imported or returned to client code.

**Likelihood:** Medium

**Impact:** Critical

**Mitigation:**

- server-only environment variable;
- never use `NEXT_PUBLIC_`;
- Razorpay API calls only on server;
- never include environment object in API responses;
- bundle/security review.

**Verification/Test:**

- inspect browser DevTools;
- search generated client bundle;
- test API responses;
- search source for client imports.

---

# SEC-002 — Webhook Secret Committed to GitHub

**Description:**  
The webhook signing secret is committed in source or `.env`.

**Likelihood:** Medium

**Impact:** Critical

**Mitigation:**

- `.env.local` ignored;
- `.env.example` contains no real values;
- manual secret scan before push;
- Vercel secret configuration.

**Verification/Test:**

Search tracked files and Git diff for the actual test secret before release.

If detected, rotate rather than merely delete.

---

# SEC-003 — Forged Webhook Accepted

**Description:**  
An attacker sends payment-looking JSON to the webhook endpoint and the application trusts it.

**Likelihood:** Medium

**Impact:** Critical

**Mitigation:**

- mandatory HMAC verification;
- raw body used;
- secret server-only;
- processing begins only after verification.

**Verification/Test:**

Run C03 with:

- wrong signature;
- missing signature;
- modified body.

Expected:

```text
zero authoritative mutation
```

---

# SEC-004 — Replayed Webhook Mutates Business State

**Description:**  
An old verified event is processed again and changes protected final merchant state.

**Likelihood:** High

**Impact:** Critical

**Mitigation:**

- internal replay architecture;
- explicit `PAYCHAOS_REPLAY`;
- event/business idempotency;
- monotonic state model.

**Verification/Test:**

Run C09.

Before/after protected state must remain equal.

---

# SEC-005 — Duplicate Event Causes Duplicate Fulfilment

**Description:**  
Duplicate external delivery or repeated processing creates multiple fulfilments.

**Likelihood:** High

**Impact:** Critical

**Mitigation:**

- unique `razorpay_event_id`;
- separate processing attempts;
- semantic fulfilment idempotency key;
- database uniqueness.

**Verification/Test:**

Run C01 and concurrent duplicate event/business-effect tests. C06 may be used additionally if its P1 scenario wrapper is implemented.

Healthy path:

```text
fulfilment count <= 1
```

---

# SEC-006 — Unauthorized User Starts Chaos Run

**Description:**  
A public internet user invokes chaos or reset functionality.

**Likelihood:** Medium

**Impact:** High

**Mitigation:**

- deployed operator access gate;
- signed server-side session;
- privileged routes check authorization;
- no browser-only authorization.

**Verification/Test:**

Call chaos endpoint without valid session.

Expected:

```text
rejected
no chaos_run created
no fault activated
```

---

# SEC-007 — PayChaos Targets Arbitrary External URL

**Description:**  
User manipulates chaos input to send requests toward unrelated infrastructure.

**Likelihood:** Low after design controls

**Impact:** Critical

**Mitigation:**

- no URL/host/IP input;
- server-owned target;
- static scenario registry;
- no arbitrary HTTP primitive.

**Verification/Test:**

Attempt request containing:

```text
target_url=https://example.com
```

Expected:

```text
validation rejection
```

and no external network action.

---

# SEC-008 — Production / Live Endpoint Accidentally Configured

**Description:**  
Developer configures Razorpay Live Mode credential.

**Likelihood:** Medium

**Impact:** Critical

**Mitigation:**

- `RAZORPAY_MODE=test`;
- `rzp_live_` rejection;
- no Live UI;
- chaos preflight;
- visible Test Mode badge.

**Verification/Test:**

Inject placeholder Live-format key.

Expected:

```text
configuration fails closed
```

---

# SEC-009 — Sensitive Payment Data Logged

**Description:**  
Payment instrument data, personal data or secrets appear in logs.

**Likelihood:** Medium

**Impact:** High

**Mitigation:**

- structured allowlisted logging;
- redacted webhook payload;
- no full request dumps;
- no card/CVV storage.

**Verification/Test:**

Run logging tests with known sentinel secret strings.

Expected:

sentinel secret absent from output.

---

# SEC-010 — Database Service-Role Key Exposed Client-Side

**Description:**  
The Supabase service-role credential enters browser bundle or frontend environment.

**Likelihood:** Low

**Impact:** Critical

**Mitigation:**

- server-only variable;
- no `NEXT_PUBLIC_`;
- database mutations through server;
- bundle inspection.

**Verification/Test:**

Search browser bundle and runtime Network responses for sentinel/service key.

Expected:

absent.

---

# SEC-011 — Malformed Input Causes Unsafe State Mutation

**Description:**  
Invalid IDs, amounts, scenario IDs or status values bypass validation.

**Likelihood:** High without validation

**Impact:** High

**Mitigation:**

- strict server schema validation;
- DB constraints;
- state-transition checks;
- reject unknown fields where useful.

**Verification/Test:**

Test:

- malformed UUID;
- negative amount;
- invalid currency;
- unknown scenario;
- browser-supplied `PAID`.

Expected:

```text
rejected
zero unintended mutation
```

---

# SEC-012 — AI Output Treated as Authoritative Payment Truth

**Description:**  
AI recommendation or text changes payment/invariant state.

**Likelihood:** Low by architecture

**Impact:** Critical

**Mitigation:**

- AI downstream of Finding;
- no mutation tools;
- deterministic payment/invariant engines;
- AI output validation.

**Verification/Test:**

Provide AI output:

```text
MARK_PAYMENT_PAID
```

Expected:

```text
no state change
```

---

# SEC-013 — Demo Fault-Injection Controls Exposed Publicly

**Description:**  
An attacker invokes low-level fault primitives directly.

**Likelihood:** Medium if poorly implemented

**Impact:** Critical

**Mitigation:**

- no standalone public fault endpoints;
- only Chaos Runner accesses fault layer;
- operator authorization;
- registered scenario/fault mapping.

**Verification/Test:**

Attempt direct invocation without valid chaos run.

Expected:

```text
rejected
```

---

# SEC-014 — Secrets Exposed in CI Logs

**Description:**  
Build/test scripts print environment variables or secrets.

**Likelihood:** Low to Medium

**Impact:** High

**Mitigation:**

- ordinary CI uses no real Razorpay secrets;
- never echo environment;
- CI secret masking;
- integration verification performed manually/protected.

**Verification/Test:**

Inspect representative CI logs before final submission.

No secret value may appear.

---

# SEC-015 — Insecure Error Messages Reveal Credentials or Internals

**Description:**  
Public errors return stack traces, connection information or secret values.

**Likelihood:** Medium

**Impact:** High

**Mitigation:**

- sanitized API errors;
- generic public messages;
- detailed server logging only;
- never interpolate credential values.

**Verification/Test:**

Trigger:

- missing secret;
- DB error;
- Razorpay error;
- malformed request.

Confirm browser receives safe messages only.

---

# 48. SECURITY DEFINITION OF DONE

Security is ready only when every mandatory condition below passes.

## Secrets

- [ ] Razorpay Key Secret is server-only.
- [ ] Razorpay webhook secret is server-only.
- [ ] Supabase service-role key is server-only.
- [ ] no real secret is committed to Git.
- [ ] `.env.local` is ignored.
- [ ] client bundle contains no privileged credential.

## Razorpay

- [ ] Test Mode is enforced.
- [ ] `rzp_live_` is rejected.
- [ ] browser success is not authoritative.
- [ ] Checkout verification occurs server-side.
- [ ] raw webhook body is preserved for verification.
- [ ] webhook HMAC verification occurs before parsing/trust.
- [ ] invalid signatures create zero business mutation.

## Database

- [ ] RLS is enabled.
- [ ] anon/client authoritative writes are denied.
- [ ] server-authoritative writes work.
- [ ] webhook event uniqueness exists.
- [ ] fulfilment idempotency uniqueness exists.
- [ ] foreign keys and state constraints are active.

## Chaos

- [ ] only approved scenarios exist.
- [ ] target is the registered Demo Merchant.
- [ ] arbitrary URLs are impossible.
- [ ] arbitrary script execution is impossible.
- [ ] arbitrary SQL is impossible.
- [ ] security preflight runs before chaos.
- [ ] unauthorized chaos requests fail.
- [ ] fault state is cleaned after runs.
- [ ] replay provenance is explicit.

## Sensitive Data

- [ ] no card number is stored.
- [ ] no CVV is stored.
- [ ] no PIN/OTP is stored.
- [ ] no real customer data is required.
- [ ] webhook evidence is redacted.
- [ ] logs contain no sensitive credentials.

## Application Security

- [ ] input validation exists.
- [ ] privileged routes are same-origin protected.
- [ ] state changes do not use GET.
- [ ] XSS-risk output is safely rendered.
- [ ] public errors reveal no secrets.
- [ ] request size is bounded.
- [ ] dependency audit has been reviewed.

## AI

- [ ] AI remains advisory.
- [ ] AI cannot write authoritative payment state.
- [ ] AI cannot write invariant results.
- [ ] AI cannot bypass chaos restrictions.
- [ ] AI receives no secrets.
- [ ] prompt-injection controls exist if an LLM is enabled.
- [ ] deterministic fallback exists.

## Testing

- [ ] SECURITY TEST MATRIX has been implemented for P0 controls.
- [ ] automated security tests actually ran.
- [ ] critical tests passed.
- [ ] manual security verification completed.
- [ ] real Razorpay Test Mode webhook was manually verified.
- [ ] invalid-signature behavior was manually or integration verified.
- [ ] unauthorized chaos behavior was verified on deployed environment.
- [ ] database RLS behavior was verified.
- [ ] final deployed browser was checked for secret exposure.

## Blocking Rule

Any open issue involving:

```text
Live Mode possibility
secret exposure
forged webhook acceptance
unauthorized fulfilment
duplicate fulfilment
arbitrary chaos targeting
unauthorized chaos execution
service-role browser exposure
AI payment authority
```

is a **P0 blocker**.

Phase 5 and the final project may not be approved while such an issue remains unresolved.

---

# Final Security Principle

The final PayChaos security model is:

```text
Untrusted Browser
        ↓
Validated + Authorized Server Boundary
        ↓
Razorpay Test Mode Only
        ↓
Verified Payment / Webhook Evidence
        ↓
RLS-Protected PostgreSQL State
        ↓
Predefined Internal Chaos Only
        ↓
Deterministic Money Invariants
        ↓
Advisory Diagnosis
```

The governing rule is:

**No secret leaves the trusted server.  
No unverified payment event becomes truth.  
No chaos action escapes the controlled Demo Merchant.  
No AI output overrides deterministic money correctness.**