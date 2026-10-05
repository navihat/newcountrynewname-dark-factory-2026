# Pocketful stage-4 acceptance tests (refunds and batch corrections)

Black-box suite derived from the stage-4 requirements (additions only; earlier suites live in `../acceptance-tests/`,
`../acceptance-tests-s2/`, `../acceptance-tests-s3/`). Node >= 18, no npm dependencies. **Run against a disposable
instance** — tests call `/_test/reset` constantly and use real sleeps (~1.1 s) to separate recorded times.

    cd stage-4
    BASE_URL=http://127.0.0.1:8080 node --test acceptance-tests-s4/index.test.mjs

(single process, serial; if you run files individually add `--test-concurrency=1`).

Files: `refunds` (refund endpoint, cumulative limits, targets, holds/available, corrections vs refunds),
`batch` (`POST /correction-batches`: auth, shape, item errors, settlement completeness, precedence, combined affordability,
atomic rejection, 201 shape, idempotency, originals/snapshots), `export` (real earlier-stage exports + stage-4 round trip),
`concurrency`.

Fixtures (`fixtures/`) are REAL exports of earlier service versions, generated from running instances:
* `stage1-export.json` / `stage1-scenario.json` — stage-1 build (`../acceptance-tests-s2/gen-stage1-export.mjs`);
* `stage2-export.json` / `stage2-scenario.json` — stage-2 build (`../acceptance-tests-s3/gen-stage2-export.mjs`);
* `stage3-export.json` / `stage3-scenario.json` — stage-3 build, commit 6634cbd, generated with `gen-stage3-export.mjs`
  (`BASE_URL=http://127.0.0.1:<port> node gen-stage3-export.mjs`); it contains a 3-member settlement, corrections, a capture,
  a pending request, retry keys and a statement snapshot token.
Their wall-clock timestamps are fixed at generation time, so no assertion depends on a hold still being open.
