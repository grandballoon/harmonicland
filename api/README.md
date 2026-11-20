# harmonicland-api

The sections server: a Cloudflare Worker over a D1 database that keeps each account's saved sections, one row per score.
The API, the anonymous-key accounts, and why they are shaped this way are documented at the top of [src/core.ts](src/core.ts); the tables are [migrations/0001_init.sql](migrations/0001_init.sql).
The app's side is `src/sections-api.ts`, `src/section-store.ts` and `src/identity.ts`.

## Local development

Needs Node 22 or newer; with nvm, `nvm use` picks it up from `.nvmrc`.

```sh
npm install
npm run dev        # applies migrations to the local database, serves on :8787
```

The local database is a SQLite file under `.wrangler/` (git-ignored).
The app's dev server (`npm run dev` in the repo root) talks to `http://localhost:8787` by default; from the root, `npm run dev:api` starts this one.
With this server down, the app keeps sections in the browser and sends them once it is back.

## Deploying

Deployed at `https://harmonicland-api.luke-conley.workers.dev`, over the D1 database `harmonicland` (its id is in `wrangler.jsonc`).
The GitHub repository variable `SECTIONS_API` holds that URL, and the Pages build reads it.

After changing the Worker or adding a migration:

```sh
npx wrangler login   # if not already
npm run deploy       # applies new migrations remotely, then deploys
```

Add any other origin the app is served from to `ALLOWED_ORIGINS` in `wrangler.jsonc`.

## Tests

The tests run with the app's suite, from the repo root: `npm test`.
