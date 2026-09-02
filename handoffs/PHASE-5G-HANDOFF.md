# PayChaos AI — Phase 5G Handoff

**Status: runbook prepared, manual rehearsal still required.** Nothing here may
be read as approval.

## Status

```text
IMPLEMENTED       = YES
TESTED            = PENDING MANUAL REHEARSAL
MANUALLY VERIFIED = NO
DOCUMENTED        = YES
APPROVED          = PENDING
```

## Phase objective

Prepare the final judge-facing demo as an operational runbook grounded in the
evidence that actually exists, without fabricating data to fit an older plan.

## Frozen architect decisions

1. **Primary demo scenario = C11 — Failed Payment Safety**, via the finding
   _INV-003 — Failed Payment Never Marks Order Paid_.
2. **Backup = C07 — INV-011 Payment State Is Legal, Monotonic and Convergent.**
3. **Do NOT generate a new C01 FAIL.** C01's current truth remains `UNKNOWN`
   and must not be changed to make the older `DEMO_PLAN.md` story easier.
4. **Demo Reset before rehearsal = NO.** Preserve all existing runtime
   evidence.
5. The demo follows **current verified evidence**, not an obsolete assumed
   state.
6. `RC-016 / INSUFFICIENT_EVIDENCE` and `INVESTIGATE-EVIDENCE-GAP` are
   presented truthfully and must not be replaced with a more impressive
   fictional diagnosis.

## Primary / backup scenario

| Role    | Scenario | Finding                                         | invariantResultId                      |
| ------- | -------- | ----------------------------------------------- | -------------------------------------- |
| Primary | C11      | INV-003 — Failed Payment Never Marks Order Paid | `266c89c3-dd2d-4314-9648-3847fb55dc16` |
| Backup  | C07      | INV-011 — Payment State Is Legal, Monotonic…    | `e6979f8c-2ea4-4dee-a9ef-9c43dcea8737` |

Both are CRITICAL, RESOLVED, and carry a persisted regression marked _Fix
verified_ with the historical FAIL preserved beside it.

## Demo Reset decision

**DO NOT RUN.** The reset clears all ten runtime tables. It would destroy both
complete findings, every regression run including the two _Fix verified_
proofs, all chaos-run evidence, and the authentic Phase 5F Razorpay Test Mode
payment and webhook — collapsing reliability to an empty state that could only
be rebuilt with another real payment and fresh chaos runs under deadline
pressure.

## Current evidence assumptions

The runbook is grounded in a read-only inventory of the live database taken at
authoring time:

```text
Reliability Score = 85 / 100
Go-Live Readiness = NEEDS ATTENTION

C01 = UNKNOWN   (−15)  Recorded test evidence
C03 = PASS      ( 0 )  Controlled PayChaos security simulation
C07 = PASS      ( 0 )  Recorded test evidence
C11 = PASS      ( 0 )  Recorded test evidence

findings = 2, both RESOLVED, both with regression RESOLVED
diagnosis = RC-016 / INSUFFICIENT_EVIDENCE
recommendation = INVESTIGATE-EVIDENCE-GAP
```

If any of these values change before the demo, the runbook's narration must be
re-checked against the new state rather than recited from memory.

## Known limitation (P1)

**The C01-specific sequence in `docs/DEMO_PLAN.md` §15/§68 differs from current
evidence.** That document assumes a C01 duplicate-fulfilment FAIL producing an
INV-002 finding with an RC-001 diagnosis. No such evidence exists — C01 is
`UNKNOWN`.

`docs/FINAL_DEMO_RUNBOOK.md` supersedes that sequence **for the current
rehearsal and demo only** and says so explicitly at the top.
`docs/DEMO_PLAN.md` was **not** rewritten and remains the architectural demo
specification.

This is P1, not P0: the demo is fully deliverable today using the C11 story.

## Demo runbook path

```text
docs/FINAL_DEMO_RUNBOOK.md
```

Contains all 22 required sections: objective, pitch, safety boundary, current
verified state, primary and backup scenarios, rationale, the exact 5-minute
script with routes / clicks / narration / expected evidence / what not to
claim, fallback behaviour, screenshot and tab preparation, pre-demo checklist,
the Demo Reset prohibition, known limitations, the C01 and C03 disclosures, the
authority sentence and the readiness disclaimer.

Target rehearsal length **4:40–4:50**.

## Files changed

```text
docs/FINAL_DEMO_RUNBOOK.md      (new)
handoffs/PHASE-5G-HANDOFF.md    (new, this file)
```

No application code. No tests. No configuration.

## Database changes

**NONE.** The only database access during Phase 5G was a read-only inventory.
No chaos, regression, payment or Demo Reset was executed.

## Migrations

```text
migration count     = 13
Phase 5G migrations = 0
```

## Automated evidence

No suite was re-run — Phase 5G changed no application code. Evidence carried
forward unchanged from Phase 4H / 5E / 5F closure:

```text
full unit                   = 154 files / 4068 tests / PASS
full Supabase integration   = 38 files  / 523 tests  / PASS
Playwright                  = 37 / 37 PASS
Phase 5E focused deployment = 50 files  / 1213 tests / PASS
typecheck / lint / build    = PASS / 0 errors (1 pre-existing warning) / PASS
migration comparison        = 13 local == 13 remote
```

The only checks executed in this phase were the git preflight,
`prettier --check` and `git diff --check` on the two new documents.

## Manual rehearsal still required

**YES.** The runbook has not been rehearsed. Before the demo the developer
must:

1. Walk the full script end to end against production and time it — target
   4:40–4:50.
2. Confirm every screen shows what the runbook says it shows.
3. Confirm the **Diagnose** click behaves as described, and practise the
   fallback line for when it does not.
4. Capture the ten screenshots listed in the runbook from the current app.
5. Re-check the live values (85 / NEEDS ATTENTION / C01 UNKNOWN) immediately
   before presenting.

## Phase boundary

**PHASE 5H HAS NOT STARTED.** No Phase 5H action was executed.

## Git state

```text
branch                  = phase-5-finalization
HEAD before this commit = 883a722f86a78f260ec2a9dedc211cf532e8937c
working tree            = clean before this documentation commit
migration count         = 13
origin/main             = 5007a6588f936651f51e01bfaf32c57dd59c0679 (untouched)
```

No amend, no merge, no force push.
