# Pocketful stage 2 — build and run

The service is Node.js (TypeScript compiled at image build time) with no runtime dependencies and
no network access once the image is built. State is in memory. The web UI is served by the same
process; all scripts and styles are bundled in the image.

```sh
docker build -t pocketful-stage2 .
docker run --rm -e PORT=8080 -p 8080:8080 pocketful-stage2
```

- `GET http://localhost:8080/health` returns `{"status":"ok"}`.
- Open `http://localhost:8080/` for the wallet; also `/requests`, `/split`, `/signup`, `/login`
  and `/authorizations`. `/requests` and `/authorizations` answer JSON unless the request
  accepts `text/html`.
- Seed state with `POST /_test/reset`; snapshot and restore it with `GET /_test/export` and
  `POST /_test/import` (a stage-1 export is accepted unchanged).
