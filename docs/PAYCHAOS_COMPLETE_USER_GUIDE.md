# PayChaos AI — Complete User Guide

**Written for someone who has never seen this application before.**

Everything below is taken from the code as it exists today. No feature is
described that does not exist, and no screenshot is invented. Where something
is not implemented, this guide says so.

> **No real money is involved anywhere in this product.** PayChaos only ever
> talks to Razorpay **Test Mode**. A live key is structurally rejected: the
> configuration requires a Key ID beginning `rzp_test_`, so the application
> refuses to start against a live one.

---

## Section 1 — What PayChaos AI is

### The problem

Most payment integrations are tested on the happy path: a customer pays, the
order is marked paid, everyone is satisfied. The expensive bugs live
elsewhere — in what happens when something goes *wrong*:

- Razorpay delivers the same webhook twice, and the merchant ships the goods twice.
- Someone forges a webhook, and the merchant marks an unpaid order as paid.
- The customer's browser closes before confirmation, and the payment is lost.
- A payment **fails**, and the order is marked paid anyway.

These are rare, hard to reproduce on demand, and each one costs real money.

### What PayChaos does

PayChaos deliberately **breaks** a controlled test merchant in exactly those
ways, then checks — deterministically — whether the merchant's money and state
stayed correct. When something breaks, it records the evidence, explains the
likely cause from that evidence, recommends a fix, and lets you re-run the same
scenario to prove the fix held.

### Why Test Mode

Because the entire point is to cause payment failures on purpose. Doing that
against real money would be reckless. Test Mode gives real Razorpay behaviour —
real API, real webhooks, real signatures — with no real money.

### What "deterministic money invariants" means

An **invariant** is a rule about money that must always be true. For example:
*one captured payment must produce at most one fulfilment.*

"Deterministic" means the answer is computed from persisted database records by
plain code — not estimated, not guessed, and never decided by an AI model. The
same evidence always produces the same verdict.

This matters because it is the difference between "we think it's fine" and "the
database proves it".

### What the Reliability Score means — and does not

The score answers exactly one question:

> **Have the four mandatory failure scenarios been tested, and did they pass?**

It does **not** mean:

- that payments are working (a successful payment does not move it);
- that the integration is certified or approved;
- anything about speed, uptime, or volume.

See Section 9 for the exact arithmetic.

---

## Section 2 — The complete system flow

```
Demo Merchant
   │  you click "Create Internal Test Order"
   ▼
internal order                    (row in `orders`, UNPAID / OPEN)
   │  you click "Create Razorpay Test Order"
   ▼
Razorpay Test Order               (row in `payment_attempts`)
   │  you click "Pay with Razorpay"
   ▼
Razorpay Checkout                 (Razorpay's own Test Mode window)
   │  Razorpay sends a webhook to PayChaos
   ▼
webhook received                  (row in `webhook_events`)
   │  the HMAC signature is verified BEFORE anything is written
   ▼
payment persisted                 (row in `payments`)
   │  merchant processing runs
   ▼
fulfilment                        (row in `fulfilments`)
   │  you run a chaos scenario from the Chaos Lab
   ▼
chaos run                         (row in `chaos_runs`)
   │  money invariants are evaluated against persisted evidence
   ▼
invariant result                  (row in `invariant_results`) — PASS / FAIL / UNKNOWN
   │  a FAIL, and only a FAIL, creates a Finding
   ▼
Finding                           (row in `findings`)
   │  deterministic rules read the evidence
   ▼
diagnosis + recommendation        (stored on the Finding)
   │  you click "Run Regression Test"
   ▼
regression run                    (row in `regression_runs` + a new chaos run)
   │  the same invariants are evaluated on the NEW evidence
   ▼
Reliability Score + Go-Live Readiness   (recalculated on every page load)
```

**What happens at each arrow, technically:**

- **Order → Razorpay Order.** PayChaos calls Razorpay's Test Mode API server-side and stores the returned Razorpay order id against the payment attempt.
- **Checkout → webhook.** Razorpay calls PayChaos's public webhook endpoint. That endpoint is deliberately *not* behind the demo login, because Razorpay cannot log in. Its protection is the HMAC signature.
- **Webhook → payment.** The raw body is verified against the webhook secret. If verification fails, **nothing is written**. Only a verified event can change payment state.
- **Chaos → invariant.** The scenario injects a controlled fault, then the invariant engine reads what actually ended up in the database.
- **Invariant → Finding.** Only a `FAIL` creates a Finding. `PASS` and `UNKNOWN` never do.
- **Regression → Score.** The score is recomputed from persisted evidence on every request. It is never stored.

---

## Section 3 — Every page

### Overview (`/`)

The landing page. Shows the product statement, the **Go-Live Readiness**
verdict, the **Reliability Score** ring, the four mandatory P0 scenarios and
their current states, and any unresolved critical/high findings.

Look at: the readiness verdict and the scenario states. Everything else is
supporting detail.

### Demo Merchant (`/demo-merchant`)

The controlled merchant PayChaos is allowed to break. Shows the fixed test
product (₹500), the payment actions, a **Payment lifecycle** chain for the most
recent order, and the full list of recent internal orders with their persisted
state.

Look at: the lifecycle chain. It runs merchant order → payment attempt →
Razorpay webhook → payment record → fulfilment, and each stage shows what has
actually been recorded.

### Chaos Runs (`/chaos`)

The Chaos Lab. Shows a safety bar (payment mode, target, evidence store,
operator), the four mandatory P0 scenarios, and the history of recent runs.

Look at: the four scenario cards and their current status.

### Chaos Run Detail (`/chaos/runs/<id>`)

One run in full. Shows the scenario name and status, then three separate
concepts — **Source**, **Chaos mechanism**, **Outcome** — then the evidence
chain, the invariant results, and the technical evidence.

Look at: Source vs Mechanism. These are deliberately separate so a PayChaos
replay is never mistaken for a real Razorpay delivery.

### Findings (`/findings`)

Every money-invariant failure PayChaos has detected, most severe first. Empty
when nothing has failed — which is *not* the same as "healthy".

### Finding Detail (`/chaos/findings/invariant-results/<id>`)

The most important screen. In order: what failed, the expected-vs-observed
proof, the evidence chain, the diagnosis, the recommended fix, the regression
proof, and finally the technical references (collapsed).

### Reliability (`/reliability`)

Score and readiness together, then the per-scenario breakdown, then what to do
next — taken directly from the readiness engine's own reasons.

### Settings (`/settings`)

Environment status (read-only exploration, interactive demo locked/unlocked,
Razorpay Test Mode), application information, a **Demo / test behavior**
section holding the controlled C01 vulnerability toggle, and a clearly
separated **Danger zone** holding Demo Reset.

### Access (`/access`)

A fallback login page. You normally never need it — the unlock dialog appears
in context instead.

---

## Section 4 — Every button

Buttons below were inventoried from the current UI. Where a button changes
state, it requires an unlocked session (see Section 11).

| Button | Page | Changes state? | Unlock needed? | What happens |
|---|---|---|---|---|
| **Create Internal Test Order** | Demo Merchant | Yes | Yes | Inserts one row into `orders` as UNPAID / OPEN / 0 fulfilments. **Contacts no Razorpay API.** Button reads "Creating…" while running. |
| **Create Razorpay Test Order** | Demo Merchant | Yes | Yes | Calls Razorpay Test Mode server-side, creates a `payment_attempts` row. Reads "Creating Razorpay Test Order…". |
| **Pay with Razorpay** | Demo Merchant | Yes | Yes | Prepares Checkout and opens Razorpay's Test Mode window. Reads "Processing…". |
| **Unlock Demo** | Unlock dialog | Yes (creates session) | — | Posts the Demo Access Code, sets a signed HttpOnly cookie, closes the dialog and **continues the action you originally clicked**. Reads "Unlocking…". |
| **Start chaos run** | Scenario page | Yes | Yes | Creates a `chaos_runs` row and navigates to the run. Reads "Starting chaos run…". |
| **Run Duplicate Replay** | Run Detail (C01) | Yes | Yes | Replays a captured webhook event. |
| **Run Invalid Signature Test** | Run Detail (C03) | Yes | Yes | Sends a deliberately mis-signed webhook. |
| **Arm Client Confirmation Drop** | Run Detail (C07) | Yes | Yes | Arms the fault that discards client confirmation. |
| **Cancel C07 Fault** | Run Detail (C07) | Yes | Yes | Disarms it. |
| **Reconcile C07** | Run Detail (C07) | Yes | Yes | Runs reconciliation after the drop. |
| **Start Failure Observation (C11-A)** | Run Detail (C11) | Yes | Yes | Begins observing a failed payment. |
| **Cancel C11-A** | Run Detail (C11) | Yes | Yes | Cancels that observation. |
| **Reconcile C11-A** | Run Detail (C11) | Yes | Yes | Reconciles the observed failure. |
| **Run Controlled Replay (C11-B)** | Run Detail (C11) | Yes | Yes | Runs the C11-B replay variant. |
| **Evaluate Money Invariants** | Run Detail | Yes | Yes | Evaluates invariants against the run's evidence, writing `invariant_results`. |
| **Re-run Money Invariant Evaluation** | Run Detail | Yes | Yes | Same, when results already exist. |
| **Re-run diagnosis** / **Diagnose finding** | Finding Detail | Yes | Yes | Runs deterministic root-cause rules. Reads "Diagnosing…". No model is involved. |
| **Run Regression Test** | Finding Detail | Yes | Yes | Starts a regression. Reads "Starting regression…". |
| **Advance regression** | Finding Detail | Yes | Yes | Moves a multi-step regression forward. Reads "Advancing…". |
| **Enable C01 Vulnerable Profile** / **Use Safe Idempotency Profile** | Settings → Demo / test behavior | Yes | Yes | Switches the controlled Demo Merchant test behavior between `SAFE` and `VULNERABLE_IDEMPOTENCY`. Affects the C01 replay path only. Reads "Applying…". |
| **Reset demo data** | Settings → Danger zone | Yes | Yes | Clears all ten runtime tables in one transaction. Requires typing `RESET`. Reads "Resetting…". |
| **See why →** | Overview | No | No | Opens Reliability. |
| **Open Chaos Lab** | Overview | No | No | Opens Chaos Runs. |
| **Reliability detail** | Overview | No | No | Opens Reliability. |
| **All findings →** | Overview | No | No | Opens Findings. |
| **Go to regression proof ↓** | Finding Detail | No | No | Scrolls to the regression section. |
| **View chaos run →** | Finding Detail | No | No | Opens the originating run. |
| **Back to Chaos Lab / Overview / chaos run** | various | No | No | Navigation. |
| **Try again** | Error screen | No | No | Reloads the failed page. |
| Sidebar navigation | all pages | No | No | Overview, Demo Merchant, Chaos Runs, Findings, Reliability, Settings. |

---

## Section 5 — Demo Merchant walkthrough

1. **Open Demo Merchant.** You see the ₹500 test product and, if no order
   exists yet, "No payment evidence yet."
2. **Click "Create Internal Test Order".** If the demo is locked, the **Unlock
   Interactive Demo** dialog appears — enter the Demo Access Code, click
   **Unlock Demo**, and the order is created automatically. You do not click
   the button again.
3. **Result:** a new order appears, UNPAID / OPEN / 0 fulfilments, conceptual
   state **CREATED**. No Razorpay call has happened yet.
4. **Click "Create Razorpay Test Order".** A Razorpay Test Mode order is
   created server-side and correlated to a payment attempt.
5. **Click "Pay with Razorpay".** Razorpay's Test Mode Checkout opens.
6. **Complete a successful test payment** using Razorpay's published Test Mode
   instruments.
7. **Razorpay sends a webhook.** PayChaos verifies its HMAC signature, stores
   the event, and only then updates payment state.
8. **Reload the page.** The lifecycle chain now shows the webhook step as
   *Verified Razorpay evidence* — the only place in the product that claims
   real Razorpay provenance, and only because the stored record proves it.
9. **On a failed payment:** the order must remain not-paid. That rule is C11,
   and it is checked deterministically rather than trusted.

---

## Section 6 — The four chaos scenarios

### C01 — Duplicate Webhook Delivery

- **Real-world failure:** Razorpay delivers the same event twice.
- **Prerequisite:** a captured real Test Mode webhook event.
- **Steps:** open C01 → **Start chaos run** → **Run Duplicate Replay** → **Evaluate Money Invariants**.
- **Injected:** the same event is replayed.
- **PASS:** the duplicate changes nothing — no second fulfilment, no double effect.
- **FAIL:** the duplicate produced a second business effect. A Finding is created.

### C03 — Invalid Webhook Signature

- **Real-world failure:** someone forges a webhook.
- **Prerequisite:** none beyond a running system.
- **Steps:** open C03 → **Start chaos run** → **Run Invalid Signature Test** → **Evaluate Money Invariants**.
- **Injected:** a deliberately mis-signed webhook.
- **PASS:** zero mutation. The event is rejected before anything is written.
- **Note:** C03 is recorded as **PayChaos simulation**, not real Razorpay evidence, because PayChaos builds the invalid request itself. The UI labels it that way.

### C07 — Payment Succeeds but Client Confirmation Is Lost

- **Real-world failure:** the payment works, but the customer's browser never confirms.
- **Prerequisite:** a real payment flow to interrupt.
- **Steps:** open C07 → **Start chaos run** → **Arm Client Confirmation Drop** → complete the payment → **Reconcile C07** → **Evaluate Money Invariants**. **Cancel C07 Fault** disarms it.
- **PASS:** the merchant reaches correct state anyway, from the webhook rather than the browser.

### C11 — Failed Payment Must Never Mark Order Paid

- **Real-world failure:** a failed payment marks the order paid.
- **Two variants:** C11-A observes a real failure; C11-B runs a controlled replay.
- **Steps (A):** **Start Failure Observation (C11-A)** → cause a failed test payment → **Reconcile C11-A** → **Evaluate Money Invariants**. **Cancel C11-A** aborts.
- **Steps (B):** **Run Controlled Replay (C11-B)** → **Evaluate Money Invariants**.
- **PASS:** the order is still not paid.
- **FAIL:** an order reached a paid state from a failed payment — critical.

**Effect on the score:** each scenario is worth 15 points of deduction while it
is untested. Passing it removes that deduction. Failing it deducts by severity.

---

## Section 7 — Findings

**A Finding is created only by a deterministic invariant `FAIL`.** A `PASS`
never creates one. An `UNKNOWN` never creates one — and `UNKNOWN` is never
treated as a pass.

Each Finding carries: the invariant id, severity, a human title, the chaos run
it came from, evidence references, and — once diagnosed — a root-cause code,
evidence-strength label, and a recommended fix.

**Status:** `OPEN` until a regression proves the failure no longer reproduces,
then `RESOLVED`. The original failure is never overwritten; the regression is
recorded *beside* it.

**Sample journey:** C01 fails → Finding created (CRITICAL, OPEN) → diagnosis
identifies a missing idempotency guard → recommendation says what to change →
you apply the fix → **Run Regression Test** → the same invariant now passes →
Finding becomes RESOLVED, with both the original FAIL and the new PASS visible.

---

## Section 8 — Regression

Regression exists because "we fixed it" is a claim, not evidence. It re-runs
the originating scenario against the merchant and re-evaluates the *same*
invariants on *new* evidence.

Start it with **Run Regression Test** on the Finding. Multi-step regressions
use **Advance regression**. PASS is determined by the same deterministic
invariant engine — nothing about the pass is asserted by hand.

When it passes, the Finding becomes RESOLVED, and because the scenario now has
a passing run, its 15-point deduction disappears and the Reliability Score
rises.

---

## Section 9 — The Reliability Score (exact rules)

This section describes the arithmetic as implemented, verified against the
scorer in `tests/unit/reliability/score-audit-matrix.test.ts`.

```
score = max(0, 100 − sum of deductions for exactly C01, C03, C07 and C11)
```

**Deduction per scenario:**

| State | Deduction |
|---|---|
| PASS | 0 |
| NOT RUN | 15 |
| UNKNOWN | 15 |
| BLOCKED | 15 |
| ERROR | 15 |
| FAIL — LOW | 10 |
| FAIL — MEDIUM | 15 |
| FAIL — HIGH | 20 |
| FAIL — CRITICAL | 25 |

**Worked examples:**

| Situation | Arithmetic | Score |
|---|---|---|
| Fresh install / after Demo Reset (all NOT RUN) | 100 − 4×15 | **40** |
| One scenario passing | 100 − 3×15 | **55** |
| One CRITICAL failure, three not run | 100 − 45 − 25 | **30** |
| C01 PASS, C03 PASS, C07 CRITICAL FAIL, C11 NOT RUN | 100 − 0 − 0 − 25 − 15 | **60** |
| All four passing | 100 − 0 | **100** |
| All four CRITICAL failing | 100 − 100 | **0** |

**Why 40 after a reset is correct.** A reset clears every chaos run, so all
four scenarios return to NOT RUN, and 4 × 15 = 60 is deducted. 40 is the
arithmetic, not an error.

**Why a normal payment does not change the score.** A payment is not one of
the four scenarios, and the scorer takes only chaos runs and invariant results
as input — a payment cannot reach it. This is deliberate: if a successful
payment raised the score, an entirely untested integration would look reliable
because the happy path worked once. That is precisely the false confidence
this product exists to remove.

**One honest caveat:** a MEDIUM failure and an untested scenario both deduct
15, so the *number alone* cannot distinguish them. The scenario breakdown and
Go-Live Readiness do — which is why no screen shows the score by itself.

**The score is never stored.** It is recalculated from persisted evidence on
every page load, so it cannot go stale. There is consequently no score history
and the Reliability page says so rather than drawing an invented trend.

**Go-Live Readiness** is a separate deterministic assessment (READY / NEEDS
ATTENTION / NOT READY) with its own blocking and attention reasons. **See why →**
opens the reasoning.

---

## Section 10 — Demo Reset

Clears all ten runtime tables in **one transaction** — either it fully applies
or nothing does. It never leaves the database half-cleared.

**Cleared:** fulfilments, regression_runs, event_processing_attempts, findings,
invariant_results, chaos_runs, webhook_events, payments, payment_attempts,
orders.

**Not touched:** database schema, migration history, RLS policies, environment
configuration, Razorpay configuration.

**Afterwards:** the score returns to **40**, all four scenarios read NOT RUN,
and the controlled C01 profile is restored to **SAFE** in the same
transaction — a vulnerable profile can never survive a reset.

Reset before a demo so the story starts from a known state. Requires typing
`RESET` and an unlocked session.

---

## Section 11 — The Demo Access Code

**Reading is public. Changing is not.**

Anyone can open the deployed URL and browse every page — Overview, Demo
Merchant, Chaos Runs, Findings, Reliability, Settings. No code required.

The moment you click something that **changes state**, the **Unlock Interactive
Demo** dialog appears. Enter the Demo Access Code once; the action you clicked
then continues automatically, and you are not asked again for the rest of the
session.

- `PAYCHAOS_ACCESS_TOKEN` — the Demo Access Code itself. Server-side only.
- `PAYCHAOS_SESSION_SECRET` — a separate secret used to sign the session cookie.

The code is never embedded in the page, never placed in a URL, never stored in
browser storage, and never logged. The session lives in a signed **HttpOnly**
cookie that JavaScript cannot read, marked `Secure` in production with
`SameSite=Lax`.

**Judges receive the Demo Access Code.** They should never receive
`PAYCHAOS_SESSION_SECRET`, the Supabase service-role key, or any Razorpay
secret.

**The dialog is a courtesy, not the security boundary.** Every state-changing
operation is refused server-side regardless of what the browser does.

---

## Section 11b — The controlled C01 vulnerability

**What it is.** A deliberate bug in the PayChaos Demo Merchant, which an
operator can switch on to prove that PayChaos detects a real duplicate-delivery
failure rather than only describing one.

**It is not a Razorpay defect.** Razorpay delivering the same webhook twice is
normal, correct provider behaviour that every merchant must tolerate. The
defect being demonstrated is the *merchant's* — PayChaos's own Demo Merchant —
and the UI says so.

**The two modes**

| Mode | The merchant's fulfilment idempotency key | Duplicate replay result |
|---|---|---|
| `SAFE` (default) | stable, derived from the order id | stays at 1 fulfilment |
| `VULNERABLE_IDEMPOTENCY` | wrongly includes the processing attempt id | becomes 2 fulfilments |

Because each replay creates a new processing attempt, the vulnerable key is
different every time, so the database's uniqueness protection never matches and
a second fulfilment is written. **No database constraint is disabled** — it
stays enabled and simply has nothing to catch, which is exactly how this bug
behaves in a real integration.

**Where to switch it:** Settings → **Demo / test behavior**. It requires the
Demo Access Code, like every other state change.

**What it cannot affect.** It applies *only* when all four are true: the
processing attempt is a PayChaos replay, it belongs to a chaos run, that run is
C01, and the vulnerable profile is switched on. Real Razorpay webhook
processing, ordinary payments, and the C03, C07 and C11 scenarios are all
unreachable from it.

**It never survives a reset.** Demo Reset restores `SAFE` in the same
transaction that clears the data.

**What it produces:** two fulfilments for one payment → `INV-002` FAIL →
a Finding → an `RC-002 MISSING_BUSINESS_IDEMPOTENCY` diagnosis. No invariant,
finding or diagnosis is fabricated; the existing deterministic engine computes
all of it from the evidence the bug leaves behind.

---

## Section 12 — What each database table is for

| Table | Holds |
|---|---|
| `orders` | The merchant's own order. Not a Razorpay order. |
| `payment_attempts` | One attempt to pay an order; carries the Razorpay order id. |
| `payments` | A verified payment, with the Razorpay payment id and signature status. |
| `webhook_events` | Every webhook received, with its signature-verification result. |
| `fulfilments` | The business effect — the thing a duplicate must never cause twice. |
| `chaos_runs` | One execution of a chaos scenario, with its provenance classification. |
| `invariant_results` | The deterministic PASS / FAIL / UNKNOWN verdict for one invariant. |
| `findings` | A failure worth acting on, created only from an invariant FAIL. |
| `regression_runs` | A re-test of a Finding, linked to the new chaos run. |
| `event_processing_attempts` | Each attempt to process a webhook event — how duplicates are detected. |

**Relationships, simply:** an order has payment attempts; an attempt has
payments; a payment has webhook events and processing attempts; a fulfilment
belongs to an order and to the processing attempt that caused it; a chaos run
produces invariant results; a failing invariant result produces a Finding; a
Finding has regression runs.

Every foreign key between these tables is `ON DELETE RESTRICT` — evidence
cannot vanish silently.

---

## Section 13 — Common states

**Order payment status:** `UNPAID`, `PENDING`, `FAILED_OBSERVED`, `PAID`.
**Order business status:** `OPEN`, `FULFILLED`.
**Conceptual state** (derived): `CREATED`, `PAYMENT_PENDING`, `PAYMENT_FAILED`, `PAID`, `FULFILLED`.

**Chaos run status:** `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`.
**Chaos run outcome:** `PASS`, `FAIL`, `UNKNOWN`, `BLOCKED`, `ERROR`.

**Invariant result:** `PASS`, `FAIL`, `UNKNOWN`. *An UNKNOWN is never a pass.*

**Scenario state on the score:** `PASS`, `FAIL`, `UNKNOWN`, `BLOCKED`, `ERROR`, `NOT_RUN`.

**Finding status:** `OPEN`, `RESOLVED`.
**Readiness:** `READY`, `NEEDS ATTENTION`, `NOT READY`.
**Interactive demo:** `LOCKED`, `UNLOCKED`, `UNAVAILABLE`.

**Provenance labels:** *Verified Razorpay evidence*, *PayChaos replay*,
*PayChaos simulation*, *Recorded evidence*, *Not yet recorded*. These are
deliberately distinct — a replay is never shown as a real Razorpay delivery.

---

## Section 14 — Troubleshooting

| Symptom | Likely cause | Exact check |
|---|---|---|
| "This screen could not be loaded." | A read of persisted evidence failed. | Check the server log for `supabase_read_failed` — it names the operation, resource and error code. |
| "Invalid Demo Access Code." | Wrong code. | Confirm `PAYCHAOS_ACCESS_TOKEN` in the deployment matches the code you were given. |
| "Interactive demo access is currently unavailable." | The gate is enabled but misconfigured. | Confirm both `PAYCHAOS_ACCESS_TOKEN` and `PAYCHAOS_SESSION_SECRET` are set, are different from each other, and meet the minimum lengths (20 / 32). |
| Checkout does not open | Razorpay order not created, or Checkout preparation failed. | Confirm the order has a Razorpay order id; check for an inline error on the button. |
| No webhook appears | Razorpay cannot reach the endpoint, or the signature failed. | Confirm the webhook URL in the Razorpay dashboard and that `RAZORPAY_WEBHOOK_SECRET` matches. A failed signature writes nothing by design. |
| Scenario will not run | A prerequisite is missing. | The scenario page states its prerequisites; C01 and C07 need real captured evidence. |
| No Finding appeared | The invariant passed. | A Finding is only ever created by a `FAIL`. Check the run's invariant results. |
| Score not changing | You did something that is not one of the four scenarios. | Only C01/C03/C07/C11 outcomes move the score. See Section 9. |
| Score stuck at 40 after a reset | Correct behaviour. | All four scenarios are NOT RUN. See Section 9. |
| Vercel deployment errors | Missing or mismatched environment variables. | Confirm all required variables exist in that environment. A missing one fails closed rather than falling open. |

---

## Section 15 — The five-minute judge demo

1. **Open Overview (~30s).** "PayChaos is an autonomous payment reliability
   engineer. It breaks a Razorpay Test Mode integration on purpose and proves
   whether money stayed correct." Point at the readiness verdict and score.
2. **Demo Merchant (~60s).** Show the lifecycle chain and one real Test Mode
   payment's evidence. Say plainly: *Test Mode, no real money.*
3. **Chaos Lab → run one scenario (~90s).** Open the scenario, start the run,
   run the fault, evaluate the invariants.
4. **Finding (~60s).** Open it. Read the expected-vs-observed proof, then the
   evidence chain, then the diagnosis and recommendation.
5. **Regression (~45s).** Run it. Show the original FAIL preserved beside the
   new PASS, and the Finding becoming RESOLVED.
6. **Reliability (~30s).** Show the score moving and the readiness reasons.
7. **Close:** "Every verdict here is deterministic and database-backed. The AI
   explains evidence; it never decides whether money is correct."

---

## Section 16 — Click-by-click beginner mode

**A. A normal payment**
Open Demo Merchant → click **Create Internal Test Order** → if the dialog
appears, enter the code and click **Unlock Demo** → the order appears as
CREATED → click **Create Razorpay Test Order** → click **Pay with Razorpay** →
complete the Test Mode payment → reload → the lifecycle shows the verified
webhook and the payment record.

**B. C01** — Chaos Runs → open C01 → **Start chaos run** → **Run Duplicate
Replay** → **Evaluate Money Invariants** → read the outcome.

**C. C03** — Chaos Runs → open C03 → **Start chaos run** → **Run Invalid
Signature Test** → **Evaluate Money Invariants** → PASS means the forged event
changed nothing.

**D. C07** — open C07 → **Start chaos run** → **Arm Client Confirmation Drop** →
complete a payment → **Reconcile C07** → **Evaluate Money Invariants**.

**E. C11** — open C11 → **Start Failure Observation (C11-A)** → cause a failed
test payment → **Reconcile C11-A** → **Evaluate Money Invariants**. (Or **Run
Controlled Replay (C11-B)** → **Evaluate Money Invariants**.)

**F. Finding + diagnosis** — Findings → click the finding title → read Expected
vs Observed → scroll to **Evidence-Based Diagnosis** → click **Re-run
diagnosis** if it is not yet diagnosed.

**G. Regression** — on the Finding, click **Go to regression proof ↓** → click
**Run Regression Test** → wait → the Finding becomes RESOLVED.

**H. Reliability Score** — Reliability → read the ring, then the per-scenario
breakdown, then "What to do next".

**I. Demo Reset** — Settings → scroll to **Danger zone** → type `RESET` →
click **Reset demo data** → the score returns to 40 and all scenarios read
NOT RUN.

---

## What still needs a human

This guide was written from the implementation. The following have **not** been
verified by clicking through a browser and should be confirmed once on the
deployed environment before the demo:

- A real Razorpay Test Mode payment end to end, including webhook delivery.
- Each chaos scenario's full button sequence against live data.
- The exact on-screen wording of scenario prerequisites.
