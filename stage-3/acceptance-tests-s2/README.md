# Pocketful stage-2 acceptance tests

Black-box suite derived from the stage-2 requirements (additions only; the stage-1 suite lives in `../acceptance-tests/`).
Node >= 18, no npm dependencies. **Run against a disposable instance** — tests call `/_test/reset` constantly.

    cd stage-2
    BASE_URL=http://127.0.0.1:8080 node --test acceptance-tests-s2/index.test.mjs

* API only (no browser): `node --test acceptance-tests-s2/index.api.test.mjs`
* Browser (UI) tests use Playwright. If `playwright-core` (or `playwright`) cannot be resolved from this folder, point
  `PLAYWRIGHT_CORE` at the package directory (a Chromium for that Playwright version must be installed). Without
  Playwright the UI browser tests are **skipped** and only the HTML-level checks run (served routes, every `data-testid`
  present in the served HTML/JS, `Accept: text/html` vs JSON negotiation on `/requests` and `/authorizations`).
* `fixtures/stage1-export.json` is a real export produced by the stage-1 service; `gen-stage1-export.mjs` regenerates it
  from a running stage-1 instance (`BASE_URL=... node gen-stage1-export.mjs`).
