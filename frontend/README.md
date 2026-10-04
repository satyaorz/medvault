# MedVault — Web frontend

Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn/ui. Talks only to the Go API
(`docs/CONTRACTS.md` §3); never to the AI service.

## Run

```bash
npm install
npm run dev            # http://localhost:3000, proxies /api/* → http://localhost:8080
API_URL=http://host:8080 npm run dev   # point at another API
```

The browser only talks to Next.js. `next.config.ts` rewrites `/api/*` to the Go API so the
httpOnly `mv_session` cookie is first-party. Rewrites are resolved at **build** time, so for
production builds set `API_URL` before `next build` (the Dockerfile takes it as a build arg,
default `http://api:8080` for docker compose).

| Script | What it does |
|---|---|
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` / `npm start` | Production build (standalone output) |
| `npm run lint` | ESLint (next/core-web-vitals + TS) |
| `npm run typecheck` | Route typegen + `tsc --noEmit` |
| `npm test` | Vitest + Testing Library (jsdom) |

```bash
docker build -t medvault-web .                                  # API at http://api:8080
docker build --build-arg API_URL=http://localhost:8080 -t medvault-web .
```

## Routes

| Route | Screen |
|---|---|
| `/login`, `/register` | Auth (zod validation, server field errors from 422 `fields`) |
| `/` | Redirects to the first profile's dashboard |
| `/profiles` | Manage family profiles (`?new=1` opens the create dialog) |
| `/p/[profileId]/dashboard` | Counts, review call-to-action, recent labs with deltas, upcoming follow-ups, recent documents |
| `/p/[profileId]/documents` | Upload (drag & drop, multi-file, progress, duplicate detection), search + filters, pagination |
| `/p/[profileId]/documents/[documentId]` | Original preview + tabs: processing stepper, extracted items, OCR text, editable details |
| `/p/[profileId]/review` | Human-in-the-loop queue with kind-specific correction forms |
| `/p/[profileId]/timeline` | Upcoming follow-ups + month-grouped events with highlight chips |
| `/p/[profileId]/labs`, `/labs/[code]` | Test grid with sparklines; trend chart with reference band and "as printed" table |
| `/p/[profileId]/medications` | Current / past medicines, visual `1-0-1` schedule, dose history |

`src/proxy.ts` (Next 16's renamed middleware) redirects app routes to `/login` when there is no
session cookie. Every API 401 also redirects (see `setUnauthorizedHandler` in `src/lib/api.ts`).

## Layout

```
src/
  app/                 routes (thin server components that await params)
  components/
    ui/                shadcn/ui primitives (generated)
    common/            badges, empty/error states, form field, page header
    layout/            app shell, sidebar, profile switcher, user menu
    documents/ review/ labs/ medications/ timeline/ dashboard/ profiles/ auth/
  hooks/               TanStack Query hooks per resource (polling while documents process)
  lib/
    types.ts           TypeScript mirror of docs/CONTRACTS.md
    api.ts             typed fetch client + ApiError
    upload.ts          XHR multipart upload with progress
    query-keys.ts      hierarchical query keys (invalidate a whole profile at once)
    review-forms.ts    zod schemas + payload conversion for the review screen
    format.ts …        pure helpers (dates, lab values, schedules, deltas) — unit tested
```

## Design notes

- **Polling, not websockets**: document lists, document detail and the dashboard refetch
  every 2 s only while something is `queued`/`processing`. When a document finishes, its items
  and the whole profile's queries are invalidated.
- **Review sends only real edits**: `buildAcceptPayload` compares form values with the original,
  so an untouched item is accepted with `{action: "accept"}`. Corrections keep the fields the form
  doesn't show (`value_original`, `unit_original`…) and recompute the lab flag from the range.
- **Errors**: HTML error pages and 5xx bodies are never shown to users; 4xx contract errors are.
