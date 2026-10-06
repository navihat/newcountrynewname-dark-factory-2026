# Pocketful stage 1 — build and run

The service is plain Node.js (TypeScript compiled at image build time). It has no runtime
dependencies and needs no network access once the image is built. State is in memory.

```sh
docker build -t pocketful-stage1 .
docker run --rm -e PORT=8080 -p 8080:8080 pocketful-stage1
```

Then `GET http://localhost:8080/health` returns `{"status":"ok"}`.

Seed state with `POST /_test/reset`; snapshot and restore state with `GET /_test/export`
and `POST /_test/import`.
