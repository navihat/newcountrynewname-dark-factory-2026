# Pocketful stage 3 — build and run

The service is Node.js (TypeScript compiled at image build time) with no runtime dependencies and
no network access once the image is built. State is in memory. The web UI is served by the same
process; all scripts and styles are bundled in the image.

```sh
docker build -t pocketful-stage3 .
docker run --rm -e PORT=8080 -p 8080:8080 pocketful-stage3
```

- `GET http://localhost:8080/health` returns `{"status":"ok"}`.
- Open `http://localhost:8080/` for the wallet; also `/requests`, `/split`, `/signup`, `/login`
  and `/authorizations`. `/requests` and `/authorizations` answer JSON unless the request
  accepts `text/html`.
- Seed state with `POST /_test/reset`; snapshot and restore it with `GET /_test/export` and
  `POST /_test/import` (stage-1 and stage-2 exports are accepted unchanged).
- Stage 3 adds `GET /statement`, `GET /me?as_of=&known_at=`, `POST /payments/{id}/corrections`
  and `GET /payments/{id}/revisions`.
