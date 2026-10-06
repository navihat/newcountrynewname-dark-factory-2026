# Pocketful stage 4 — build and run

The service is Node.js (TypeScript compiled at image build time) with no runtime dependencies and
no network access once the image is built. State is in memory. The web UI is served by the same
process; all scripts and styles are bundled in the image.

```sh
docker build -t pocketful-stage4 .
docker run --rm -e PORT=8080 -p 8080:8080 pocketful-stage4
```

- `GET http://localhost:8080/health` returns `{"status":"ok"}`.
- Open `http://localhost:8080/` for the wallet; also `/requests`, `/split`, `/signup`, `/login`
  and `/authorizations`. `/requests` and `/authorizations` answer JSON unless the request
  accepts `text/html`.
- Seed state with `POST /_test/reset`; snapshot and restore it with `GET /_test/export` and
  `POST /_test/import` (exports of stages 1 to 3 are accepted unchanged).
- Stage 3 adds `GET /statement`, `GET /me?as_of=&known_at=`, `POST /payments/{id}/corrections`
  and `GET /payments/{id}/revisions`.
- Stage 4 adds `POST /payments/{id}/refunds` and `POST /correction-batches` (settlement operators).
