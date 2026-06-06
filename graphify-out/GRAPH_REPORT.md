# Graph Report - ZIG Khazana  (2026-06-04)

## Corpus Check
- Corpus is ~28,790 words - fits in a single context window. You may not need a graph.

## Summary
- 707 nodes · 1008 edges · 47 communities (28 shown, 19 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 58 edges (avg confidence: 0.81)
- Token cost: 235,549 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Dashboard UI (Frontend)|Dashboard UI (Frontend)]]
- [[_COMMUNITY_Execution Pipeline + Decision Gate|Execution Pipeline + Decision Gate]]
- [[_COMMUNITY_Exchange REST + Reconciliation|Exchange REST + Reconciliation]]
- [[_COMMUNITY_Market Ingestion + Orderbook|Market Ingestion + Orderbook]]
- [[_COMMUNITY_Engine Bootstrap + Infra Wiring|Engine Bootstrap + Infra Wiring]]
- [[_COMMUNITY_Control-Plane API + Security|Control-Plane API + Security]]
- [[_COMMUNITY_Domain Types + Reconciliation Engine|Domain Types + Reconciliation Engine]]
- [[_COMMUNITY_Shared Contracts + ConfigDocker|Shared Contracts + Config/Docker]]
- [[_COMMUNITY_Execution Adapters (paperreal)|Execution Adapters (paper/real)]]
- [[_COMMUNITY_Chaos Harness + Treasury Engine|Chaos Harness + Treasury Engine]]
- [[_COMMUNITY_Session + State Recovery|Session + State Recovery]]
- [[_COMMUNITY_Core Engine Orchestration|Core Engine Orchestration]]
- [[_COMMUNITY_WebSocket Base Client|WebSocket Base Client]]
- [[_COMMUNITY_Execution Authority Components|Execution Authority Components]]
- [[_COMMUNITY_Order Registry + Store|Order Registry + Store]]
- [[_COMMUNITY_MEXC Protobuf WebSocket|MEXC Protobuf WebSocket]]
- [[_COMMUNITY_Operational Mode Control|Operational Mode Control]]
- [[_COMMUNITY_Trading Session (credentials)|Trading Session (credentials)]]
- [[_COMMUNITY_Session Manager|Session Manager]]
- [[_COMMUNITY_Config Loading (Zod env)|Config Loading (Zod env)]]
- [[_COMMUNITY_Treasury Types|Treasury Types]]
- [[_COMMUNITY_Legacy ExecutorRouter|Legacy Executor/Router]]
- [[_COMMUNITY_MEXC Protobuf Migration|MEXC Protobuf Migration]]
- [[_COMMUNITY_Structured Logger|Structured Logger]]
- [[_COMMUNITY_Error Sanitization (key safety)|Error Sanitization (key safety)]]
- [[_COMMUNITY_Credential Crypto Vault|Credential Crypto Vault]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]

## God Nodes (most connected - your core abstractions)
1. `BybitRestClient` - 17 edges
2. `MexcRestClient` - 17 edges
3. `OrderRegistry` - 16 edges
4. `OrderbookEngine` - 15 edges
5. `Core Engine Bootstrap (main)` - 12 edges
6. `MexcWebSocketClient` - 11 edges
7. `StateEngine` - 11 edges
8. `PaperEngine` - 10 edges
9. `ModeManager` - 10 edges
10. `TreasuryEngine` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Engineering Principles` --rationale_for--> `ExecutionRequest`  [INFERRED]
  README.md → packages/shared-types/src/execution.ts
- `DashboardAccountState` --semantically_similar_to--> `ExchangeBalance`  [INFERRED] [semantically similar]
  frontend/src/types/index.ts → packages/shared-types/src/exchange.ts
- `Authority Model` --rationale_for--> `DriftStatus`  [INFERRED]
  README.md → packages/shared-types/src/reconciliation.ts
- `DashboardTreasury` --semantically_similar_to--> `DerivedTreasury`  [INFERRED] [semantically similar]
  frontend/src/types/index.ts → packages/shared-types/src/treasury.ts
- `Engineering Principles` --rationale_for--> `DerivedTreasury`  [INFERRED]
  README.md → packages/shared-types/src/treasury.ts

## Hyperedges (group relationships)
- **Control-plane security chain (rate-limit, token, sanitize, audit)** — ratelimit_ratelimiter, requireoperator_verifyoperatortoken, sanitizebody_validatecredentialbody, audit_auditlog [INFERRED 0.85]
- **Decision gate layers (mode, risk, treasury)** — allowtrade_checktradepermission, riskengine_assessrisk, treasurygate_checktreasurygate, modecontroller_modecontroller [INFERRED 0.85]
- **Credential leak prevention surfaces** — httperror_stripcredentials, audit_neversecrets, requireoperator_failclosed [INFERRED 0.75]

## Communities (47 total, 19 thin omitted)

### Community 0 - "Dashboard UI (Frontend)"
Cohesion: 0.05
Nodes (44): Dashboard(), AccountStatePanel(), ExchangeKey, Props, statusClass, EventLog(), levelStyle, levelTag (+36 more)

### Community 1 - "Execution Pipeline + Decision Gate"
Cohesion: 0.06
Nodes (23): checkTradePermission(), TradePermission, TradePermissionStatus, assessRisk(), RiskAssessment, RiskViolation, checkTreasuryGate(), TreasuryGateConfig (+15 more)

### Community 2 - "Exchange REST + Reconciliation"
Cohesion: 0.07
Nodes (20): BybitResponse, BybitRestClient, parseNumber(), sanitizeHttpError(), RealFillSink, MexcRestClient, detectBalanceMismatches(), detectDrift() (+12 more)

### Community 3 - "Market Ingestion + Orderbook"
Cohesion: 0.06
Nodes (13): buildBybitNormalizedState(), classifyVolatility(), BybitOrderbookMessage, BybitTradeMessage, BybitWebSocketClient, MexcRestDepth, MexcRestPoller, MarketIngestionPipeline (+5 more)

### Community 4 - "Engine Bootstrap + Infra Wiring"
Cohesion: 0.07
Nodes (18): connectDatabase(), disconnectDatabase(), getPrisma(), OrderReconciler, CredentialInput, finitePositive(), OrderInput, validateCredentialBody() (+10 more)

### Community 5 - "Control-Plane API + Security"
Cohesion: 0.06
Nodes (25): AuditAction, AuditLog, AuditRecord, ApiServer, ApiServerOptions, clientIp(), DashboardAccountState, DashboardBalance (+17 more)

### Community 6 - "Domain Types + Reconciliation Engine"
Cohesion: 0.06
Nodes (31): ReconciliationEngine, ExchangeBalance, ExchangeConnectorHealth, ExchangeFill, ExchangeOrder, OrderSide, OrderStatus, ExecutionOrder (+23 more)

### Community 7 - "Shared Contracts + Config/Docker"
Cohesion: 0.07
Nodes (37): Authority Model, Build Roadmap (phases), Core Objective (harvest volatility safely), Engineering Principles, Operational Modes table, Repository Structure, Security Model, SystemHeader component (+29 more)

### Community 8 - "Execution Adapters (paper/real)"
Cohesion: 0.09
Nodes (11): EventSink, ExecutionAdapter, PlaceAck, PaperEngine, PriceProvider, TopOfBook, BybitExecutionAdapter, cancelOrder() (+3 more)

### Community 9 - "Chaos Harness + Treasury Engine"
Cohesion: 0.13
Nodes (18): check(), exFill(), exOrder(), fillEvent(), log, mockClient(), req(), run() (+10 more)

### Community 10 - "Session + State Recovery"
Cohesion: 0.07
Nodes (32): AccountStatePanel, reserveFloor splits totalBase into active vs reserve inventory, Pure deterministic derivation; weighted-avg cost basis; state reconstructable from fills, deriveTreasury, Treasury combines fills across both exchanges (venue-agnostic ZIG holding), TreasuryEngine, EventLog, ExchangeCard (+24 more)

### Community 11 - "Core Engine Orchestration"
Cohesion: 0.08
Nodes (29): checkTradePermission (decision gate), Mode gate first, risk engine second, AuditLog, Audit records never contain secrets, buildBybitNormalizedState, DB failure degrades to market-data-only mode, Prisma DB client, broadcastState (+21 more)

### Community 12 - "WebSocket Base Client"
Cohesion: 0.12
Nodes (16): BaseWebSocketConfig, clearHeartbeat(), clearPongTimer(), clearStaleTimer(), clearTimers(), connect(), destroy(), markSequenceGap() (+8 more)

### Community 13 - "Execution Authority Components"
Cohesion: 0.09
Nodes (25): ExecutionAdapter, Async fill delivery mirrors exchange WS, detectDrift, Pure deterministic drift detection, Order state machine TRANSITIONS, canTransition, Explicit validated transitions are sole truth, ModeManager (+17 more)

### Community 14 - "Order Registry + Store"
Cohesion: 0.13
Nodes (6): canTransition(), isTerminal(), TRANSITIONS, OrderStore, TERMINAL, OrderRegistry

### Community 15 - "MEXC Protobuf WebSocket"
Cohesion: 0.11
Nodes (11): DecodedDeal, DecodedDepth, DecodedMessage, decodeMexcMessage(), DepthLevel, Long, Wrapper, WrapperMessage (+3 more)

### Community 17 - "Trading Session (credentials)"
Cohesion: 0.24
Nodes (3): Credentials, SessionStatus, TradingSession

### Community 19 - "Config Loading (Zod env)"
Cohesion: 0.32
Nodes (7): Config, EnvSchema, getConfig(), getOperationalMode(), loadConfig(), OperationalMode, OperationalModeSchema

### Community 20 - "Treasury Types"
Cohesion: 0.33
Nodes (5): DerivedTreasury, DeriveTreasuryOptions, InventoryPool, TreasuryInventory, TreasurySnapshot

### Community 21 - "Legacy Executor/Router"
Cohesion: 0.33
Nodes (6): ExchangeAdapter (router), ExchangeRouter, Executor, Idempotency marked before network call, IdempotencyStore, OrderManager

### Community 22 - "MEXC Protobuf Migration"
Cohesion: 0.4
Nodes (5): BybitWebSocketClient, decodeMexcMessage (protobuf decoder), MEXC v3 WS migrated to protobuf Aug 2025, MexcWebSocketClient, REST seed before first protobuf delta

### Community 24 - "Error Sanitization (key safety)"
Cohesion: 0.67
Nodes (4): BybitRestClient, sanitizeHttpError, Strip axios config so API keys never leak into logs, MexcRestClient

### Community 25 - "Credential Crypto Vault"
Cohesion: 0.5
Nodes (4): CredentialCrypto, AES-256-GCM authenticated credential encryption, ExchangeClientFactory, Only place credentials are read

### Community 28 - "Community 28"
Cohesion: 1.0
Nodes (3): MexcRestPoller, MarketIngestionPipeline, OrderbookEngine

### Community 29 - "Community 29"
Cohesion: 0.67
Nodes (3): BaseWebSocketClient, Sequence state machine: monotonic increase only, not strict +1; avoids reconnect loops, Heartbeat/pong/stale timers detect silent websocket desync and force reconnect

## Knowledge Gaps
- **194 isolated node(s):** `log`, `AuditAction`, `AuditRecord`, `RouteContext`, `RouteHandler` (+189 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ReconciliationEngine` connect `Domain Types + Reconciliation Engine` to `Exchange REST + Reconciliation`, `Engine Bootstrap + Infra Wiring`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Why does `StateEngine` connect `Execution Pipeline + Decision Gate` to `Operational Mode Control`, `Exchange REST + Reconciliation`, `Market Ingestion + Orderbook`, `Engine Bootstrap + Infra Wiring`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `Core Engine Bootstrap (main)` (e.g. with `Execution-sync polling loop` and `PAPER fills excluded from Treasury/Account state`) actually correct?**
  _`Core Engine Bootstrap (main)` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `log`, `AuditAction`, `AuditRecord` to the rest of the system?**
  _194 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Dashboard UI (Frontend)` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Execution Pipeline + Decision Gate` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Exchange REST + Reconciliation` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._