# PayChaos AI — Final Demo Runbook

**This is the current operational demo runbook.**

It supersedes the C01-specific assumed sequence in `docs/DEMO_PLAN.md`
**for the current final rehearsal and demo only**, because the persisted
evidence in the live database differs from what that document assumed.
`DEMO_PLAN.md` is not rewritten and remains the architectural demo
specification.

The reason is stated plainly rather than papered over: `DEMO_PLAN.md` §15 and
§68 assume a C01 duplicate-fulfilment FAIL producing an INV-002 finding with an
RC-001 diagnosis. **That evidence does not exist in the current database.** C01
is `UNKNOWN`. Fabricating it was explicitly rejected. This runbook therefore
demonstrates the strongest story the verified evidence actually supports.

---

## 1. Demo objective

In five minutes, a Razorpay reviewer should understand:

1. what PayChaos is
2. why Test Mode makes it safe
3. how it deliberately breaks a payment assumption
4. how deterministic money invariants detect the failure
5. how evidence is preserved
6. how diagnosis explains verified evidence — and refuses to guess
7. how the recommendation maps to the failure
8. how regression proves the fix
9. how the Reliability Score and Go-Live Readiness explain themselves

Core story:

```text
BREAK → DETECT → PROVE → DIAGNOSE → FIX → RE-TEST → READINESS
```

## 2. One-line pitch

> PayChaos AI is an autonomous payment reliability engineer. It deliberately
> breaks a payment integration in Razorpay Test Mode, proves what broke with
> deterministic money invariants, and then proves the fix.

## 3. Safety boundary

> Razorpay Test Mode only.

No live key. No real money. Chaos only ever targets the internal controlled
Demo Merchant — never Razorpay infrastructure and never an external target.

## 4. Current verified demo state

Confirmed by a read-only inventory of the live database at runbook time.

```text
Reliability Score = 85 / 100
Go-Live Readiness = NEEDS ATTENTION

C01 = UNKNOWN   (−15)  Recorded test evidence
C03 = PASS      ( 0 )  Controlled PayChaos security simulation
C07 = PASS      ( 0 )  Recorded test evidence
C11 = PASS      ( 0 )  Recorded test evidence
```

Two findings, both complete end to end:

| Finding                                          | Scenario | Status   | Regression   | Diagnosis                    | Recommendation           |
| ------------------------------------------------ | -------- | -------- | ------------ | ---------------------------- | ------------------------ |
| INV-003 — Failed Payment Never Marks Order Paid  | C11      | RESOLVED | **RESOLVED** | RC-016 / INSUFFICIENT_EVIDENCE | INVESTIGATE-EVIDENCE-GAP |
| INV-011 — Payment State Is Legal, Monotonic…     | C07      | RESOLVED | **RESOLVED** | RC-016 / INSUFFICIENT_EVIDENCE | INVESTIGATE-EVIDENCE-GAP |

Plus the authentic Razorpay Test Mode payment and `payment.captured` webhook
verified in Phase 5F, still visible on the Demo Merchant.

## 5. Primary scenario

**C11 — Failed Payment Safety**, via the finding
**INV-003 — Failed Payment Never Marks Order Paid**
(`invariantResultId 266c89c3-dd2d-4314-9648-3847fb55dc16`).

## 6. Backup scenario

**C07 — INV-011 Payment State Is Legal, Monotonic and Convergent**
(`invariantResultId e6979f8c-2ea4-4dee-a9ef-9c43dcea8737`).

Structurally identical and equally complete; use it if the C11 finding page
fails to load.

## 7. Why C11 is primary

- **The complete story is already persisted.** BREAK → DETECT → PROVE →
  DIAGNOSE → FIX → RE-TEST is all on one page, with a real regression marked
  *Fix verified* and the historical FAIL preserved beside it. Nothing has to
  happen live for the story to hold.
- **The claim is instantly legible to a payments reviewer:** *a failed payment
  must never mark an order paid.* No setup needed. C07's "legal, monotonic and
  convergent state" costs twenty seconds of explanation the demo does not have.
- **Deterministic and zero-risk:** no chaos run, no payment, no external
  timing dependency during judging.
- **CRITICAL severity**, so the stakes are self-evident.

It was not chosen for visual appeal. It is the only complete, safe, fully
evidenced path available.

## 8–12. Exact 5-minute script

Target rehearsal length **4:40–4:50**, leaving margin under five minutes.

**The only live click is Diagnose.** It is idempotent, was verified twice in
production, and changes no authoritative state.

---

### 0:00–0:25 · Pitch

- **Route:** `https://paychaos-ai.vercel.app/`
- **Click:** nothing
- **Say:** "PayChaos AI is an autonomous payment reliability engineer. It
  deliberately breaks a payment integration in Razorpay Test Mode, proves what
  broke with deterministic money invariants, and then proves the fix."
- **Evidence on screen:** PayChaos AI, "Autonomous Payment Reliability
  Engineer", **RAZORPAY TEST MODE** badge
- **Do not claim:** production-safe, certified

### 0:25–0:55 · Safety and current verdict

- **Route:** same
- **Click:** nothing
- **Say:** "Everything you will see is Razorpay Test Mode only — no live key,
  no real money. Right now this integration scores 85 out of 100 and reads
  NEEDS ATTENTION, and it tells you exactly why."
- **Evidence:** readiness decision panel, score 85/100, the leading reason
- **Do not claim:** guaranteed, production ready
- **Fallback:** the Reliability tab shows the same values

### 0:55–1:30 · The four mandatory scenarios

- **Route:** same, scroll to "Required P0 scenarios"
- **Click:** nothing
- **Say:** "Four mandatory failure scenarios gate go-live. Three pass. C01 is
  UNKNOWN — and UNKNOWN is never treated as a pass. It costs fifteen points."
- **Evidence:** scenario matrix, C01 amber `UNKNOWN`, C03 provenance reading
  *Controlled PayChaos security simulation*
- **Do not claim:** all failures covered

### 1:30–2:20 · The failure and its evidence

- **Route:** left nav → **Findings** → open *INV-003 — Failed Payment Never
  Marks Order Paid*
- **Click:** nav "Findings", then the finding title
- **Say:** "A deterministic money invariant failed. Expected: a failed payment
  never marks an order paid. Observed: the order was marked paid. That verdict
  is deterministic — the authority is stated on the block itself."
- **Evidence:** CRITICAL severity, invariant verdict block, Expected vs
  Observed, `AUTHORITY: DETERMINISTIC`, evidence references
- **Do not claim:** that Razorpay charged anyone, or that this exists anywhere
  beyond the recorded failure

### 2:20–3:05 · Evidence-Based Diagnosis — the live moment

- **Route:** same page, section 03
- **Click:** **Re-run diagnosis**
- **Say:** "This runs the deterministic root-cause rules over the persisted
  evidence. Watch what it does when the evidence is not strong enough: it
  returns INSUFFICIENT_EVIDENCE and recommends investigating the gap. It does
  not guess. Payment truth and invariant results are deterministic. AI explains
  verified evidence. Diagnosis never determines payment state."
- **Evidence:** RC-016, INSUFFICIENT_EVIDENCE, the authority line,
  INVESTIGATE-EVIDENCE-GAP
- **Do not claim:** that a model produced this, or that a specific technical
  root cause was identified
- **Fallback:** the values are already persisted. If the click fails, say
  "this finding is already diagnosed" and carry on — nothing is lost

> **Framing note.** RC-016 / INSUFFICIENT_EVIDENCE is a weaker headline than a
> specific root cause, and it is the most defensible thing in the product. Most
> AI demos hallucinate a confident cause. PayChaos looked at real evidence,
> judged it insufficient, and said so. Present it as that, honestly — do not
> dress it up as precise root-cause identification.

### 3:05–3:55 · Regression proof

- **Route:** same page, section 05
- **Click:** nothing
- **Say:** "Finding the bug is half the job. PayChaos re-ran the same scenario
  and recorded what happened. Before: the original FAIL, still on record.
  After: PASS. The historical failure is never rewritten — Fix verified appears
  only when a regression genuinely resolved."
- **Evidence:** Before/After panel, historical FAIL preserved and labelled,
  *Fix verified* badge
- **Do not claim:** that all such bugs are fixed
- **This is the strongest fifty seconds of the demo. Do not rush it.**

### 3:55–4:35 · Reliability and readiness

- **Route:** left nav → **Reliability**
- **Click:** nav "Reliability"
- **Say:** "The score is derived from persisted evidence on every load —
  nothing stored, nothing hard-coded. Readiness explains itself: gates the
  runtime cannot verify say so, rather than claiming a pass."
- **Evidence:** score, NEEDS ATTENTION, per-scenario contributions, the
  eleven-gate checklist with honest UNKNOWNs
- **Do not claim:** READY, certification

### 4:35–5:00 · Close

- **Route:** same
- **Click:** nothing
- **Say:** "Deterministic money truth, verified evidence, bounded explanation,
  and proof the fix held — before any of it reaches production." Then read the
  disclaimer aloud.
- **Evidence:** readiness disclaimer visible

---

## 13. What must not be claimed

Never say:

```text
AI decides payment state
AI determines payment truth
Razorpay certified
production safe
guaranteed
all failures covered
real merchant performance   (for synthetic evidence)
```

## 14. Fallback behaviour

The primary script is already close to fallback-safe: it uses persisted
evidence plus one idempotent click. If Razorpay is unavailable, Vercel is slow,
the Diagnose button fails, or network timing is poor:

1. Present from the prepared screenshots in the same order.
2. Say explicitly: **"This is recorded test evidence from an earlier verified
   run, not an event happening during this judge session."**
3. Never imply recorded evidence is live.
4. C03 remains *Controlled PayChaos security simulation, not a real Razorpay
   event* in every retelling.

## 15. Screenshot / tab preparation

Pre-open and pre-authenticate, in this order:

```text
1. /                          Overview
2. /findings                  Findings
3. INV-003 Finding Detail     the primary story
4. /reliability               Reliability
5. /demo-merchant             backup proof of the Phase 5F real payment
```

Capture these screenshots from the **current** application. Do not create or
edit images to show anything the app does not show.

```text
1.  Overview with Test Mode badge, score and readiness
2.  Scenario matrix with C01 UNKNOWN
3.  Findings list with both CRITICAL findings
4.  INV-003 header + invariant verdict block
5.  Evidence-Based Diagnosis: RC-016, INSUFFICIENT_EVIDENCE, authority line
6.  Recommended Fix: INVESTIGATE-EVIDENCE-GAP
7.  Regression Before vs After with Fix verified
8.  Reliability with the gate checklist and disclaimer
9.  Demo Merchant: PAID / FULFILLED / 1 effect, payment.captured,
    "Razorpay Test Mode — Real Event"
10. A chaos run detail showing the evidence rail including
    "Evidence not captured"
```

**Do not make another Razorpay payment for demo preparation.** The Phase 5F
evidence is already persisted and visible.

## 16. Pre-demo checklist

**Browser** — logged in with the operator token · production URL only · five
tabs pre-opened · no stale localhost tab · zoom ~100–110%.

**Vercel** — deployment Ready and promoted to Production.

**Razorpay** — Test Mode · webhook Enabled.

**Data** — score 85 · readiness NEEDS ATTENTION · C01 UNKNOWN · C03/C07/C11
PASS · both findings present with *Fix verified* · **Demo Reset not run** ·
avoid creating extra test orders.

**Presentation** — screenshots ready · rehearsed to 4:40–4:50 · fallback line
memorised.

Final UI attractiveness polish is deliberately deferred; do not spend
rehearsal time on appearance.

## 17. Demo Reset — DO NOT RUN

**DEMO RESET = DO NOT RUN.**

`lib/demo-reset/service.ts` clears all ten runtime tables: `regression_runs`,
`findings`, `invariant_results`, `event_processing_attempts`, `chaos_runs`,
`webhook_events`, `fulfilments`, `payments`, `payment_attempts`, `orders`.

Running it would destroy every asset this demo depends on — both complete
findings, all regression runs including the two *Fix verified* proofs, all
chaos-run evidence, and the authentic Phase 5F Test Mode payment and webhook.
Reliability would collapse to a fresh empty state, and rebuilding it would need
another real payment and fresh chaos runs under deadline pressure.

## 18. Known demo limitations

- The diagnosis on both findings is `RC-016 / INSUFFICIENT_EVIDENCE`, not a
  specific technical root cause. Present it honestly.
- C01 remains `UNKNOWN`, so the documented C01 duplicate-fulfilment narrative
  cannot be shown.
- No live chaos run is performed during the demo, by design.
- Final UI polish is deferred.

## 19. C01 disclosure

If asked about C01, say:

> C01 is currently UNKNOWN. That means we do not have conclusive evidence for
> it, and PayChaos refuses to score an unknown as a pass — it costs fifteen
> points and it is one of the reasons readiness is NEEDS ATTENTION rather than
> READY.

Do not imply C01 passed. Do not generate C01 evidence to make the story neater.

## 20. C03 provenance disclosure

Whenever C03 appears:

> Controlled PayChaos security simulation, not a real Razorpay event.

## 21. Authority sentence

Quote exactly:

> Payment truth and invariant results are deterministic. AI explains verified
> evidence. Diagnosis never determines payment state.

## 22. Readiness disclaimer

Quote exactly:

> PayChaos Go-Live Readiness is an engineering assessment from the implemented
> PayChaos test suite. It is not Razorpay certification.
