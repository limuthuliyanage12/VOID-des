# VOID · Events by the Void — backend

The real backend for the VOID prototype, built by team IIT ATP-CS24: one source of truth for inventory and money, so it never oversells and never loses a payment.

| Package | What it is |
| --- | --- |
| `apps/api` | Express 5 + Mongoose 8 + zod. Every route under `/api/v1`. |
| `apps/worker` | BullMQ worker for when `REDIS_URL` is set. Without Redis the API runs jobs itself. |
| `apps/web` | The VOID site. Every page loads `api.js`, which fetches from the API before the page scripts run. The API serves it in development. |
| `packages/shared` | zod schemas, money and date helpers, status words, response types. Both sides import it. |

## Run it

Node 22 or newer. pnpm comes through corepack, so nothing global is needed.

```powershell
corepack pnpm install
corepack pnpm dev:mem      # in-memory MongoDB replica set, seeded, API + site on http://localhost:4000
corepack pnpm test         # 63 tests: unit, API, concurrency, signatures
```

`dev:mem` prints the demo accounts (password `Void-demo-2027`). Data is gone when it stops.

### With a real database

Transactions need a replica set. Pick one:

- **Docker**: `docker compose up -d`, then `MONGODB_URI=mongodb://localhost:27017/void?replicaSet=rs0&directConnection=true` and `REDIS_URL=redis://localhost:6379`.
- **Windows service** (MongoDB Server installed with winget): run `scripts/setup-sandbox-admin.ps1` once **as administrator** (switches the service to replica set `rs0` and installs Memurai for Redis), then `node scripts/init-replset.mjs`.

Then copy `.env.example` to `.env`, fill it in, and:

```powershell
corepack pnpm seed         # wipes, seeds and runs the seed check
corepack pnpm dev          # API with reload
corepack pnpm worker       # only when REDIS_URL is set
```

### Payment sandboxes

- **PayHere**: sign up at sandbox.payhere.lk, register the domain, put the Merchant ID and that domain's secret in `.env`. The notify URL must be public HTTPS, so point a tunnel (for example `cloudflared tunnel --url http://localhost:4000`) at the API and set `API_PUBLIC_URL` to it. Refunds need a Merchant API app (`PAYHERE_APP_ID` / `PAYHERE_APP_SECRET`); without it they are simulated outside production.
- **Koko**: `KOKO_DRIVER=mock` simulates approval locally with real RSA-signed callbacks. The `http` driver targets qaapi.paykoko.com, but its endpoint paths are placeholders until the team has the Koko merchant pack (`src/lib/koko.ts`, `KOKO_PATHS`).
- **Demo mode** (`DEMO_MODE=true`, never in production): `POST /api/v1/dev/payhere/complete {"orderId":"VOID-2701843"}` sends a correctly signed PayHere callback through the real webhook. `GET /api/v1/dev/outbox` shows the emails and SMS (split links, tickets, invites) the log drivers would have sent.

## How the hard parts work

- **No oversell.** A hold is one conditional `findOneAndUpdate` with `sold + held + qty <= total`, inside a transaction that also inserts the hold. The test fires 200 holds at the last 158 Phase 3 tickets and exactly 158 win.
- **Payments.** PayHere `hash` and `md5sig` are built and checked on the server only. Callbacks are stored raw, de-duplicated by `(provider, providerPaymentId)`, and answered at once; the `completePayment` job does the work and is safe to run twice. A payment that arrives after its hold lapsed still sells if there is room, and is refunded if there isn't.
- **Split pay.** The lead pays first, the 48-hour clock starts then, the remainder goes on the lead's share, and tickets issue only when every share is paid. Expiry or an organizer release gives the inventory back and refunds every paid share.
- **QR tickets.** Ed25519-signed tokens (`V1.payload.sig`) with per-event keys, encrypted at rest. Scanners can verify offline (`GET …/gate/keys`). A unique index on admitted scans makes a second admit fail even under a race; offline sync keeps the earliest admit and flags the other.
- **Scope guard.** Every `/admin/events/{eventId}` route checks the token's `assignedEventId`, and every query filters by it as well. Role and event are re-checked against the database on every write.
- **Jobs.** Exact delayed jobs for hold and split expiry, plus a minute sweep as the safety net and a TTL index as the last backstop. The schedule (tier advance, Koko sync, 8 am digest, payouts, reserve release, nightly PDPA scrub) runs in BullMQ with Redis, or in-process without it.

## The site on the API

Open http://localhost:4000 after `corepack pnpm dev:mem`. What runs where:

- `apps/web/api.js` is the only file that talks to the backend. `API.start(page, scripts)` refreshes the session from the httpOnly cookie, loads that page's data into `window.BOOT`, then runs the page's own scripts in order, so they still render synchronously.
- Fan pages: real holds (with the 9 min 41 s timer), presale codes, checkout, PayHere or Koko, split pay with friend links, table holds from the 3D List View, confirmation and My Tickets with signed QR codes and PDF tickets, transfers and refund requests. Guests' orders are remembered on the device in `void.mine`.
- Consoles: `admin.html` and `super.html` ask for a staff sign-in, load their screens' data from the API, and every button calls the API and re-renders. Gate staff see only the gate screen.
- Demo mode: checkout sends a correctly signed PayHere callback through the real webhook instead of opening a card form; with live PayHere keys and `DEMO_MODE=false` the browser posts the form to PayHere. The console's "Scan a valid ticket" fetches a real signed QR from `/api/v1/dev/events/{id}/sample-qr`.

## Seed notes

The seed reproduces the prototype's numbers (`src/seed/check.ts` asserts them: 1,842 sold, LKR 16,578,000 gross, 158 Phase 3 left, LKR 27,238,000 platform gross, the table statuses). Where the prototype contradicted itself:

- Its table orders named tables the map showed as free. Here `VOID-2701840` is Table **P02** (reserved) and split SP-037 holds **G06**, so the map statuses stay exactly as specified.
- Split group SP-036 had no order, so `VOID-2701836` exists.
- The GA split groups sit inside the 1,842 sold, as the prototype counted them. Releasing one reverses that sale.
- The dashboard's "8 of 16 tables reserved" was hard-coded. The API counts the real tables: 3 reserved, 2 held.
- P05's hold is a checkout in progress and lapses 10 minutes after seeding, like any other hold.

## Not done yet

- Apple and Google Wallet passes return 501 until there are developer accounts; the PDF ticket works.
- Playwright end-to-end runs and the GitHub Actions pipeline aren't written.
- Rate limits use a per-process memory store; use a Redis store when running several API instances.
- Route files are grouped by audience (`src/routes/public|admin|super|webhooks|dev.ts`) and services by area (`src/modules/*`), rather than one routes/service/repo triple per area.
