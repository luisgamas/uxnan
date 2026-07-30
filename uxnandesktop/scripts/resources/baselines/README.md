# Approved baselines

One directory per platform, holding the **aggregate** documents (not the raw
samples) that `compare.mjs` measures a candidate against.

```
baselines/
└── windows/
    ├── R00.json
    ├── R01.json
    └── …
```

A file here is a claim about the product, so getting one in has rules:

1. Measured with a **release** build on a quiet machine, five repetitions.
2. Every other uxnan instance closed — see the WebView2 note in
   [`../../../docs/resource-benchmarks.md`](../../../docs/resource-benchmarks.md).
   A run that never grew a webview inside its own tree is invalid and must not be
   promoted.
3. Copied straight from `.resource-results/aggregates/` — never hand-edited.
4. Committed **on their own**, separate from any code change, so a reviewer can
   tell measurements from behaviour.
5. The commit body records the machine (the `hostId` in the document), the
   webview version and anything unusual about the conditions.

Replacing a baseline means the numbers moved for a reason you can state. Say the
reason in the commit; "re-baselined" on its own is how a budget quietly becomes
meaningless.

A baseline's own `verdict` field reads `unknown`, and that is correct: a baseline
*is* the line, so judging it against the budget derived from it would be
circular. Verdicts belong to candidate runs.

Platforms with no directory here have **no approved baseline**: `compare.mjs`
reports `unknown` for them, which is the honest answer, and nothing about those
platforms should be published.

## What is in `windows/` today

Captured 2026-07-30 on Windows 11 Pro 10.0.26200 (x64), WebView2 150.0.4078.105,
i7-13620H / 16 logical cores, 16 GB, "Equilibrado" power plan, release build of
`54d935e8`. Five repetitions per scenario, measurement windows shortened from the
scenario defaults (each result records its own `durationS` / `stabilizeS`).

Eleven scenarios: R00–R06, R09 in all three variants, and R11. **Missing: R07 and
R08** (operator-driven) and **R10** (the two-hour soak, never run). Those three
therefore have no budget entry and report `unknown` — which is the point of
distinguishing "not judged" from "passed".
