# ownrun-web

Vue 3 SPA for OwnRun. Built static assets deploy to site root (`/`); the API lives at `/api/index.php` (no `mod_rewrite`). Client routes use the URL hash (`/#/login`). Asset URLs are relative so the same build also works under a subdirectory (e.g. `/~user/ownrun-web/dist/`).

## Development

```bash
npm install
npm run dev
```

Vite dev server proxies `/api` to `http://localhost:8080` (run `ownrun-server` locally on that port).

## Production build

```bash
npm run build
```

Deploy the contents of `dist/` to your web root. Hash routing needs no Apache rewrite.

If the API is not at `/api/index.php` on the same host, build with `VITE_API_BASE` set (e.g. `/ownrun-server/api/index.php`).

## Features (v1)

- Login with optional Remember me (JWT + refresh tokens)
- Job list with runner online/offline indicator
- Create Ollama text jobs with model selector
- Job detail with polling while queued/running
- Cancel queued jobs; requeue failed jobs

## License

OwnRun is distributed under the [GNU Affero General Public License v3](COPYING.txt) (AGPL-3.0).
