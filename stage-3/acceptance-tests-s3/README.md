# Pocketful stage-3 acceptance tests (statements, as_of/known_at, corrections)

Black-box suite derived from the stage-3 requirements (additions only; earlier suites live in `../acceptance-tests/` and
`../acceptance-tests-s2/`). Node >= 18, no npm dependencies. **Run against a disposable instance** — tests call
`/_test/reset` constantly and use real sleeps (~1.1-1.2 s) to separate recorded times.

    cd stage-3
    BASE_URL=http://127.0.0.1:8080 node --test acceptance-tests-s3/index.test.mjs

Files: `asof` (payment timestamps, `GET /me?as_of`, `known_at`), `statement` (windows, pagination, snapshots),
`corrections` (validation, effects, idempotency, revisions, known_at, settlements/captures), `holds_hist` (historical holds,
`closed_at`, historical overdraft), `export` (stage-1/stage-2/stage-3 export import), `concurrency`.

Fixtures (`fixtures/`) are REAL exports of earlier service versions, generated from running instances:
* `stage1-export.json` / `stage1-scenario.json` — built from `stage-1/` with `../acceptance-tests-s2/gen-stage1-export.mjs`;
* `stage2-export.json` / `stage2-scenario.json` — built from `stage-2/` (commit aa528cd carry-forward) with `gen-stage2-export.mjs`
  (`BASE_URL=http://127.0.0.1:<port> node gen-stage2-export.mjs`).
Their wall-clock timestamps are fixed at generation time, so assertions never depend on a hold still being open.
