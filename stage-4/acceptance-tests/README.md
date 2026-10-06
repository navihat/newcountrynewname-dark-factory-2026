# Pocketful stage-1 acceptance tests

Black-box suite derived from the written requirements only. Node >= 18, no dependencies.

Run (against a running service): `BASE_URL=http://127.0.0.1:8080 node --test acceptance-tests/index.test.mjs`
(from `stage-1/`), or `cd acceptance-tests && BASE_URL=http://127.0.0.1:8080 npm test`.

The suite resets the service repeatedly (`POST /_test/reset`); run it only against a disposable instance.
Tests are serial (single process) — do not run files in parallel.
