# ZIG Khazana — Treasury Volatility Harvesting Infrastructure

> A deterministic financial state machine over unreliable exchange infrastructure.
> **Not** a trading bot. **Not** a market maker. Treasury volatility harvesting with safety as the first principle.

---

## What this system is

ZIG Khazana harvests volatility on the ZIG token across **Bybit** and **MEXC** while preserving treasury exposure. The design priority is, in order:

> **correctness → safety → observability → maintainability**

It is built for **1–2 operators**, not hyperscale. Every architectural decision optimizes for *treasury safety and execution correctness*, never throughput or "AI hype."

### Core objective
Harvest volatility safely while preserving treasury exposure — sell into strength, rebuy into weakness, never "support the market," never justify a bad trade for "liquidity."

---

## The authority model (non-negotiable)

```
Risk Engine            ← sovereign; nothing bypasses it
    ↓
Execution Permissions
    ↓
Treasury Constraints
    ↓
Market State           ← AI feeds interpretation HERE, never into the chain
```

- **Exchange truth > local DB truth.** Always. On mismatch, exchange wins; local is rebuilt from it.
- **AI is OUTSIDE the authority chain.** It classifies and interprets only — it cannot predict price, place trades, or override constraints.
- **READ_ONLY by default.** The system never trades unless explicitly authorized.

---

## Tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript (Node.js 22+) |
| Backend runtime | `tsx` (dev), `tsc` build |
| Database | PostgreSQL 16 (via Prisma) |
| Cache | Redis 7 |
| Frontend | Next.js 15 + React 19 + Tailwind |
| Market data | Bybit WebSocket (JSON), MEXC WebSocket (Protobuf) |
| Crypto | AES-256-GCM (credential vault) |
| Monorepo | pnpm workspaces + Turbo |
| Infra | Docker Compose |
| Monitoring | Telegram (operational audit feed) |

---

## Repository structure

```
ZIG Treasury/
├── backend/                  # @zig/core-engine — the system
│   ├── prisma/schema.prisma  # DB schema (co-located with the package that owns DB)
│   └── src/
│       ├── main.ts                     # Composition root — wires everything
│       ├── api/                        # Dashboard API + control plane
│       │   ├── server.ts               # HTTP + WS server, route segregation
│       │   ├── audit.ts                # Control-action audit log (no secrets)
│       │   └── middleware/
│       │       ├── require-operator.ts # Constant-time operator token check
│       │       ├── rate-limit.ts       # Sliding-window per ip+route
│       │       └── sanitize-body.ts    # Strict payload validation
│       ├── state-engine/               # Single source of truth
│       │   ├── store.ts                # SystemState + action ownership model
│       │   ├── reducer.ts              # Pure reducer (fill dedup, exchange-truth-wins)
│       │   └── index.ts                # StateEngine (event-driven dispatch)
│       ├── market-ingestion/
│       │   └── pipeline.ts             # WS → NormalizedMarketState → state engine
│       ├── websocket/
│       │   └── base-client.ts          # Reconnect, heartbeat, stale + sequence state machine
│       ├── exchange/
│       │   ├── bybit/{rest,websocket,normalizer}.ts
│       │   ├── mexc/{rest,websocket,normalizer,protobuf}.ts
│       │   └── http-error.ts           # Sanitizes axios errors (strips key-bearing headers)
│       ├── orderbook/engine.ts         # Snapshot/delta book, spread/imbalance
│       ├── decision-gate/              # Authority gate
│       │   ├── risk-engine.ts          # Structural risk checks (full rules = Phase 5)
│       │   ├── allow-trade.ts          # mode + risk → trade permission
│       │   ├── treasury-gate.ts        # Reserve-floor / active-inventory enforcement
│       │   └── mode-controller.ts      # Mode transitions → state engine
│       ├── execution-engine/           # Phase 4 — live (PAPER verified)
│       │   ├── pipeline.ts             # The one path: gates → adapter → registry
│       │   ├── lifecycle.ts            # Order state machine (validated transitions)
│       │   ├── registry.ts             # Managed orders, fill dedup, persistence
│       │   ├── order-store.ts          # Durable orders (real only) ↔ Postgres
│       │   ├── order-reconciler.ts     # Crash recovery: rebuild from exchange truth
│       │   ├── paper-engine.ts         # Simulated fills (same OrderEvents as real)
│       │   ├── real-adapter.ts         # Bybit/MEXC place/cancel (NORMAL-gated) + router
│       │   └── adapter.ts              # ExecutionAdapter contract
│       ├── chaos/harness.ts            # `npm run chaos` — 5 failure-mode scenarios
│       ├── treasury/                   # Phase 3 — treasury accounting
│       │   ├── derive.ts               # Pure: fills → cost basis, harvest, exposure
│       │   ├── fill-ledger.ts          # Append-only fills (paper never persists)
│       │   └── engine.ts               # Ingest fills → derive → snapshots
│       ├── reconciliation/{engine,drift-detector}.ts  # Classified drift + repair
│       ├── state/recovery.ts           # Startup state recovery from exchange
│       ├── session/                    # Credential lifecycle
│       │   ├── crypto.ts               # AES-256-GCM encrypt/decrypt
│       │   ├── credential-store.ts     # Encrypted blobs ↔ Postgres
│       │   ├── session-manager.ts      # Decrypt → AuthenticatedExchangeClient
│       │   ├── exchange-client-factory.ts
│       │   ├── credential-vault.ts
│       │   └── trading-session.ts
│       ├── database/client.ts          # Prisma client + connect/disconnect
│       └── telegram/notifier.ts        # Telegram alerts
├── frontend/                 # @zig/dashboard — Next.js live dashboard
│   └── src/
│       ├── app/{layout,page}.tsx
│       ├── components/{SystemHeader,ExchangeCard,EventLog,SessionPanel,TreasuryPanel,ExecutionPanel}.tsx
│       └── hooks/useSystemState.ts     # WS subscription to backend state
├── packages/
│   ├── shared-types/         # @zig/shared-types — pure types, zero runtime
│   │   └── src/{market,exchange,treasury,reconciliation,execution,modes}.ts
│   ├── logger/               # @zig/logger — pino structured logger
│   └── config/               # @zig/config — Zod-validated env loading
├── docker-compose.yml        # Production: NO exposed ports, internal network only
├── docker-compose.override.yml # Dev: binds Postgres/Redis to 127.0.0.1 only
├── Dockerfile                # 3-stage build → minimal runner
└── .env.example
```

---

## What's built

### ✅ Phase 1 — Exchange connectivity (complete)

Trustworthy exchange-state replication from both venues.

- **Bybit WebSocket** — orderbook snapshot/delta + trades (JSON).
- **MEXC WebSocket** — migrated to **Protobuf** (Aug 2025 API change): endpoint `wbs-api.mexc.com`, `.pb` channels (`aggre.depth` / `aggre.deals`), REST-seeded orderbook + binary-frame decoding.
- **Sequence state machine** — `UNINITIALIZED → IN_SYNC → RESYNCING`; monotonic validation (not strict `+1`), so snapshot→delta jumps don't trigger false resyncs.
- **Resilience** — exponential-backoff reconnect, ping/pong heartbeat, stale-stream detection (threshold > heartbeat interval).
- **NormalizedMarketState** — single canonical market object: bid/ask, spread (bps), mid, liquidity imbalance, volatility regime, freshness, ws + sequence status. Exchange-specific shapes never leak past the adapter.

### ✅ Phase 2 — Session lifecycle + control-plane security (complete)

- **Encrypted credential vault** — exchange keys submitted via frontend → AES-256-GCM encrypted → stored as ciphertext in Postgres. Raw keys **never** in `.env`, logs, or responses. Decrypted only into RAM during an active session.
- **Restart safety** — on boot, stored credentials are loaded, decrypted, and the session re-established automatically; then state recovery runs.
- **AuthenticatedExchangeClient** — recovery/reconciliation receive only this; they never touch raw keys, encryption, or sessions.
- **Control-plane authorization** (command authorization, *not* user auth):
  - Route segregation: `/api/public/*` (open reads) vs `/api/operator/*` (control, auto-protected by prefix).
  - Operator token (`x-operator-token`), constant-time compare, **fail-closed** (no token = control disabled).
  - Strict payload validation, 8 KB body cap, per-route rate limiting, CORS locked to dashboard origin.
  - Audit log on every control action (`action, ip, success, exchange`) — never secrets.
- **Error sanitization** — REST clients strip axios `config.headers` (which carry API keys) before any error is logged.

### ✅ Phase 2 core — reconciliation engine (complete)

Per-exchange financial consensus, every 5 min + on session start:
`fetch exchange truth → read local view → detect drift → classify → repair → persist report`.
- **Drift classes**: `MATCH / SOFT_DRIFT / HARD_DRIFT / CRITICAL_DRIFT` (`drift-detector.ts`, pure).
- **Detects**: ghost orders, duplicate fills, negative balances (CRITICAL); balance mismatch, missing fills, stale orders (HARD).
- **Repairs**: HARD → exchange truth wins (full-replace balances/orders); **fills append + dedup by `fillId`, never overwrite**.
- **CRITICAL → auto-HALT** via the mode controller (not auto-repaired — surfaced to operator).
- Reports persisted to `reconciliation_reports`.

### ✅ Phase 3 — Treasury accounting engine (complete)

"Treasury memory" — financial meaning derived purely from the **fill ledger**.
- **`deriveTreasury()`** (pure): weighted-average cost basis, realized (harvested) PnL, unrealized exposure, inventory value. Reconstructable from fills alone (order-independent — verified).
- **Reserve-floor model**: `active = max(holdings − RESERVE_FLOOR, 0)`; reserve is protected, never sold into.
- **`FillLedger`** — append-only, dedup by `fillId`. **Paper fills never persist.**
- **`TreasuryEngine`** — ingests fills → re-derives; durable snapshots every 5 min to `treasury_state`.
- Dashboard **Treasury panel**: active/reserve split, avg cost, mark, harvested/unrealized PnL, fees.

### ✅ Phase 4 — Execution engine (complete; PAPER verified, real placement operator-gated)

Controlled, deterministic execution. One pipeline; operator clicks and the paper harness travel the *same* path through the *same* gates.
- **Canonical `ExecutionRequest`** → `Mode gate → Risk gate → Treasury (reserve) gate → Idempotency → Adapter → Registry`.
- **Order state machine** (`lifecycle.ts`): `CREATED→SUBMITTED→OPEN→PARTIALLY_FILLED→FILLED / CANCEL_PENDING→CANCELLED / REJECTED / FAILED` — validated transitions only.
- **Paper engine** — simulates fills against live top-of-book; emits the *same* `OrderEvent`s as real adapters. Paper orders are in-memory only (never DB / treasury / account-state).
- **Durable orders + crash recovery** — real orders persist (`managed_orders`); on restart the registry hydrates and **rebuilds each live order from exchange truth** (open orders + fills). Idempotency survives restart.
- **Real adapters** (`real-adapter.ts`) — Bybit/MEXC place + cancel, **gated to NORMAL/DEFENSIVE**. Real fills detected by an 8s execution-sync loop (polling exchange truth).
- **Chaos harness** (`npm run chaos`) — 5 failure modes (duplicate fills, partial-fill-during-reconnect, cancel race, restart recovery, delayed WS), 14 assertions, all passing. Caught & fixed two real bugs (fill double-count, premature cancellation).

### ✅ Live dashboard

Real-time view at `http://localhost:3000` over a WebSocket to the engine (port 3001):
- Per-exchange cards: connection status, bid/ask/mid, spread (bps), regime badge, buy/sell pressure, freshness.
- System header: mode, uptime, session status, LIVE indicator.
- Event log: connects, disconnects, stale warnings, reconciliation, mode changes, execution journal.
- Session panel: encrypted key entry + operator token + per-exchange keyed status + remove.
- Treasury panel: active/reserve inventory, cost basis, harvested/unrealized PnL.
- Execution panel: place limit orders (paper in PAPER_MODE), live managed-order status, cancel.

---

## Operational modes

| Mode | Behavior |
|---|---|
| `READ_ONLY` | Observe only. **Default on startup.** No execution. |
| `PAPER_MODE` | Full execution logic against live data — simulated orders. |
| `NORMAL` | Standard volatility harvesting. |
| `DEFENSIVE` | Lower sizing, wider spreads, reduced aggression. |
| `HALT` | Cancel orders, stop execution, reconcile, safe shutdown. |

Mode is checked before the risk engine on every execution decision. `CRITICAL_DRIFT` forces `HALT` automatically.

---

## API surface

| Method | Route | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | none | Liveness |
| `GET` | `/api/public/session-status` | none | Which exchanges are keyed (no secrets) |
| `POST` | `/api/operator/credentials` | operator token | Submit + encrypt exchange keys |
| `DELETE` | `/api/operator/credentials` | operator token | Remove stored keys (clears account state) |
| `POST` | `/api/operator/order` | operator token | Place a limit order (paper in PAPER_MODE, real in NORMAL) |
| `DELETE` | `/api/operator/order` | operator token | Cancel a managed order by `clientOrderId` |
| `WS` | `/ws` | none (local) | Live dashboard state stream |

---

## Running locally

```powershell
# 1. Install
pnpm install

# 2. Build shared packages (once, or after changing them)
pnpm --filter @zig/shared-types build
pnpm --filter @zig/logger build
pnpm --filter @zig/config build

# 3. Start Postgres + Redis (dev override binds to 127.0.0.1 only)
docker compose up -d postgres redis

# 4. Push the DB schema (first time / after schema changes)
cd backend
DATABASE_URL="postgresql://postgres:postgres@localhost:15432/zig_treasury" node node_modules/prisma/build/index.js db push
cd ..

# 5. Configure environment
copy .env.example .env    # then fill values (see below)

# 6. Run — two terminals
cd backend  && npm run dev   # engine + API on :3001
cd frontend && npm run dev   # dashboard on :3000
```

Open **http://localhost:3000**.

> **Note:** Windows reserves port 5432, so dev Postgres runs on host port **15432** (container still 5432). Reflected in `.env` and `docker-compose.override.yml`.
> If you hit `EADDRINUSE` on 3001, a zombie `node` process is holding it: `Get-Process node | Stop-Process -Force`.

### Verifying execution
```powershell
cd backend && npm run chaos   # 5 failure-mode scenarios, 14 assertions
```
To exercise the pipeline live without risk: set `OPERATIONAL_MODE=PAPER_MODE`, then use the dashboard **Execution** panel (enter the operator token, place a limit order) — fills are simulated, nothing touches a real exchange.

### Going live (real orders) — operator checklist
1. Set a non-zero **`RESERVE_FLOOR`** (protects your base inventory).
2. Add your real exchange key via the dashboard Session panel.
3. Set **`OPERATIONAL_MODE=NORMAL`** and restart.
4. First test: place a **tiny** limit order far from mid (so it rests), watch `OPEN`, then **cancel** it — no fill, no cost. Only then try a marketable tiny order to see a real fill flow into treasury.
> Real order placement is the **only** path not covered by automated tests (it needs real funds). Everything upstream is verified.

### Environment variables

| Var | Purpose | Notes |
|---|---|---|
| `DATABASE_URL` | Postgres connection | dev: `...@localhost:15432/zig_treasury` |
| `REDIS_URL` | Redis connection | |
| `ENCRYPTION_KEY` | 64 hex chars — credential vault master key | empty = ephemeral (dev only, won't survive restart) |
| `OPERATOR_TOKEN` | Control-plane token | empty = control routes disabled (fail-closed) |
| `API_HOST` / `API_PORT` | API bind | `0.0.0.0` / `3001`; use `127.0.0.1` behind a proxy |
| `DASHBOARD_ORIGIN` | CORS allow-list | set to real dashboard URL in prod |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Alerts | optional in dev |
| `OPERATIONAL_MODE` | Startup mode | `READ_ONLY` default; `PAPER_MODE` to test execution; `NORMAL` for real |
| `TRADING_SYMBOL` | Pair | `ZIGUSDT` |
| `BASE_ASSET` / `QUOTE_ASSET` | Treasury assets | `ZIG` / `USDT` |
| `RESERVE_FLOOR` | Protected reserve (base asset) | `0` = entire balance harvestable. **Set non-zero before NORMAL.** |

**Exchange API keys are NOT environment variables** — they are submitted at runtime via the dashboard and stored encrypted.

---

## Security model (summary)

1. **System secrets** (DB, Redis, Telegram, encryption key, operator token) live in `.env`.
2. **User exchange keys** are ephemeral session credentials — entered via frontend, encrypted at rest, decrypted only in memory, never logged or returned.
3. **Control endpoints** require the operator token; reads are public on the bound interface.
4. **Fail-closed** everywhere: no token → no control; no encryption key → no persistence.
5. **Assume the frontend, DB, and logs can leak** — protection is encryption + isolation + no plaintext persistence.

### Before deploying to a server
- Set a strong `OPERATOR_TOKEN` (`openssl rand -hex 32`).
- **HTTPS is mandatory** (keys are POSTed) — terminate TLS at a reverse proxy.
- Prefer `API_HOST=127.0.0.1` behind the proxy; set `DASHBOARD_ORIGIN`.
- Set a real `ENCRYPTION_KEY` and a strong DB password.
- Residual risk after all this: **server compromise** (runtime memory holds decrypted keys) — an infra-hardening problem, not endpoint auth.

---

## Build roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Exchange connectivity + market state | ✅ Complete |
| 2 | Session security + reconciliation + state recovery | ✅ Complete |
| 3 | Treasury accounting (active vs reserve, cost basis, harvest) | ✅ Complete |
| 4 | Execution engine (limit orders, lifecycle, recovery, chaos-tested) | ✅ Complete — PAPER verified; real placement operator-gated |
| 5 | Risk engine (full adaptive rules: exposure, volatility, liquidity) | ⬜ Next — structural gate only today |
| 6 | Telegram operations (commands: /status, /halt, /pause) | 🔄 Alerts done; commands later |
| 7 | AI layer (Bedrock — advisory, outside the authority chain) | ⬜ |
| — | Market replay tooling | ⬜ Deferred |

> **Note:** phase numbering was compressed during the build (orderbook folded into Phase 1; session+reconciliation merged into Phase 2). Execution is "Phase 4" in current usage.

---

## Engineering principles

- **Event-driven**, no `while(true)` polling.
- **No hidden state** — anything important is persisted, reproducible, rebuildable.
- **Execution is dumb and sovereign** — the pipeline validates intent and executes; it never decides *what* to trade. One path for operator + harness + (future) strategy.
- **Idempotency** — every order has a deterministic `clientOrderId`; a timeout is never treated as a failure (recovery resolves the truth).
- **Exchange truth > local truth** — on any mismatch, local state is rebuilt from the exchange.
- **Fills are append-only** — recorded once (dedup by `fillId`), never overwritten; treasury is reconstructable from the fill ledger.
- **Exchange/strategy decoupling** — everything flows through `NormalizedMarketState`.
- **Telegram as an audit feed**, not notifications.
