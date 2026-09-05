# Graph Report - .  (2026-09-04)

## Corpus Check
- Corpus is ~46,229 words - fits in a single context window. You may not need a graph.

## Summary
- 1092 nodes · 1717 edges · 93 communities (48 shown, 45 thin omitted)
- Extraction: 94% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 94 edges (avg confidence: 0.85)
- Token cost: 285,358 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Exchange REST + Reconciliation|Exchange REST + Reconciliation]]
- [[_COMMUNITY_Accumulation Engine + Budget|Accumulation Engine + Budget]]
- [[_COMMUNITY_Risk Engine + Sizing + State|Risk Engine + Sizing + State]]
- [[_COMMUNITY_Config Contract + Auth UI|Config Contract + Auth UI]]
- [[_COMMUNITY_Soak Control + Harvest Cycles|Soak Control + Harvest Cycles]]
- [[_COMMUNITY_Market Ingestion + Orderbook|Market Ingestion + Orderbook]]
- [[_COMMUNITY_Control-Plane API + Audit|Control-Plane API + Audit]]
- [[_COMMUNITY_Treasury Ledger + Chaos Harness|Treasury Ledger + Chaos Harness]]
- [[_COMMUNITY_Execution Adapters (paperreal)|Execution Adapters (paper/real)]]
- [[_COMMUNITY_Shared Domain Types|Shared Domain Types]]
- [[_COMMUNITY_README Architecture Doctrine|README Architecture Doctrine]]
- [[_COMMUNITY_Zone Manager (classify + policy)|Zone Manager (classify + policy)]]
- [[_COMMUNITY_WebSocket Base Client|WebSocket Base Client]]
- [[_COMMUNITY_Order Lifecycle + Store|Order Lifecycle + Store]]
- [[_COMMUNITY_Accumulation Cycle Tracker|Accumulation Cycle Tracker]]
- [[_COMMUNITY_MEXC Protobuf Decoding|MEXC Protobuf Decoding]]
- [[_COMMUNITY_Soak v2 Test Harness|Soak v2 Test Harness]]
- [[_COMMUNITY_Soak Reporter (Telegram)|Soak Reporter (Telegram)]]
- [[_COMMUNITY_Account State Panel (UI)|Account State Panel (UI)]]
- [[_COMMUNITY_Execution Authority Components|Execution Authority Components]]
- [[_COMMUNITY_Virtual Paper Account|Virtual Paper Account]]
- [[_COMMUNITY_Zod Env Config Loader|Zod Env Config Loader]]
- [[_COMMUNITY_Soak Telegram Controller|Soak Telegram Controller]]
- [[_COMMUNITY_Accumulation Test Harness|Accumulation Test Harness]]
- [[_COMMUNITY_Dashboard Shell + Auth UI|Dashboard Shell + Auth UI]]
- [[_COMMUNITY_Operational Mode Control|Operational Mode Control]]
- [[_COMMUNITY_App User Store (dashboard auth)|App User Store (dashboard auth)]]
- [[_COMMUNITY_PaperSoak Orchestrator|PaperSoak Orchestrator]]
- [[_COMMUNITY_Telegram Command Plumbing|Telegram Command Plumbing]]
- [[_COMMUNITY_Trading Session (credentials)|Trading Session (credentials)]]
- [[_COMMUNITY_Soak Settings + Zone Config|Soak Settings + Zone Config]]
- [[_COMMUNITY_Execution Pipeline + Driver Params|Execution Pipeline + Driver Params]]
- [[_COMMUNITY_Harvest Cycle Tracker|Harvest Cycle Tracker]]
- [[_COMMUNITY_Exchange Card (UI)|Exchange Card (UI)]]
- [[_COMMUNITY_Accumulation Budget|Accumulation Budget]]
- [[_COMMUNITY_Treasury Panel (UI)|Treasury Panel (UI)]]
- [[_COMMUNITY_ZoneManager Service|ZoneManager Service]]
- [[_COMMUNITY_Engine Bootstrap + DB Client|Engine Bootstrap + DB Client]]
- [[_COMMUNITY_Payload Sanitization|Payload Sanitization]]
- [[_COMMUNITY_Telegram Command Listener|Telegram Command Listener]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]

## God Nodes (most connected - your core abstractions)
1. `VirtualAccount` - 21 edges
2. `OrderRegistry` - 20 edges
3. `SoakReporter` - 20 edges
4. `BybitRestClient` - 17 edges
5. `MexcRestClient` - 17 edges
6. `SoakController` - 16 edges
7. `OrderbookEngine` - 15 edges
8. `StateEngine` - 15 edges
9. `PaperEngine` - 13 edges
10. `Adaptive Zone Manager + Controlled Accumulation phase` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Below-band defensive stance` --semantically_similar_to--> `Dry-powder floor (MIN_USDT_RESERVE_FLOOR)`  [INFERRED] [semantically similar]
  backend/src/zone-manager/zone-policy.ts → docs/PHASE_ZONE_ACCUMULATION.md
- `ZoneManager service` --conceptually_related_to--> `Zone/accumulation block reason codes`  [AMBIGUOUS]
  backend/src/zone-manager/zone-manager.ts → docs/PHASE_ZONE_ACCUMULATION.md
- `Engineering Principles` --rationale_for--> `ExecutionRequest`  [INFERRED]
  README.md → packages/shared-types/src/execution.ts
- `Zone-anchored sell trigger (replaces avgCost anchor)` --conceptually_related_to--> `decideZone (pure zone policy)`  [INFERRED]
  docs/PHASE_ZONE_ACCUMULATION.md → backend/src/zone-manager/zone-policy.ts
- `DashboardTreasury` --semantically_similar_to--> `DerivedTreasury`  [INFERRED] [semantically similar]
  frontend/src/types/index.ts → packages/shared-types/src/treasury.ts

## Hyperedges (group relationships)
- **Credential leak prevention surfaces** — httperror_stripcredentials, audit_neversecrets, requireoperator_failclosed [INFERRED 0.75]
- **Accumulation Intent Lifecycle (gate → budget → pipeline → cycle)** — accumulationengine_attempt_buy, accumulationbudget_accumulation_budget, accumulationengine_submit, riskengine_risk_engine, accumulationcycletracker_tracker, accumulationtypes_accumulation_cycle [INFERRED 0.85]
- **Control-Plane Defense in Depth (rate limit → operator token → audit → session cookie)** — server_dispatch, server_operator_prefix_gate, audit_audit_log, userstore_app_user_store, main_operator_routes, server_ws_authorization [INFERRED 0.85]
- **Risk Decision Pipeline (config → context → gates → policies → decision)** — riskconfig_build_risk_config, riskcontext_build_risk_context, riskengine_hard_gates, riskengine_policies, risktypes_decision_factories, risktypes_risk_decision [INFERRED 0.95]
- **Paper soak closed loop: intent to fill to accounting to report** — harvest_driver_HarvestDriver, pipeline_ExecutionPipeline, paper_engine_PaperEngine, virtual_account_VirtualAccount, cycle_tracker_CycleTracker, reporter_SoakReporter [INFERRED 0.95]
- **Paper/real isolation barrier across persistence layers** — order_store_paper_never_persisted, fill_ledger_append_only_invariant, virtual_account_disposable_mirror, pipeline_staged_gate [INFERRED 0.85]
- **Slippage-induced failure modes and their defenses** — cycle_tracker_intent_anchored_bucket, cycle_tracker_fifo_no_regate, harvest_driver_close_before_open, soak_v2_test_bug_regression_intent [INFERRED 0.85]
- **Zone evaluation pipeline: inputs -> classify -> policy -> decision -> change event** — zonetypes_zoneclassifierinputs, zoneclassifier_classifyzone, zonepolicy_decidezone, zonetypes_zonedecision, zoneevents_zonechangeevent, zonemanager_zonemanager [INFERRED 0.95]
- **Capital protection stack: ZIG reserve floor, USDT dry powder, deployment caps, never-bypass risk pipeline** — phasezone_reservefloorprotection, phasezone_drypowderfloor, phasezone_neverbypasspipeline, config_envschema, zonepolicy_belowbanddefensive [INFERRED 0.85]
- **Operator control-plane UI: token-authenticated dashboard surfaces** — page_dashboard, signinpage_page, sessionpanel_panel, executionpanel_panel, frontend_operatortokenheader, config_operatortokenfailclosed [INFERRED 0.85]

## Communities (93 total, 45 thin omitted)

### Community 0 - "Exchange REST + Reconciliation"
Cohesion: 0.05
Nodes (23): BybitResponse, BybitRestClient, parseNumber(), sanitizeHttpError(), RealFillSink, MexcRestClient, detectBalanceMismatches(), detectDrift() (+15 more)

### Community 1 - "Accumulation Engine + Budget"
Cohesion: 0.05
Nodes (57): AccumulationBudget, Dry-Powder & Harvest-Reserve Priority, UTC Daily Budget Roll, FIFO Principal Reclaim (no price re-gate), openForRecovery Eligibility Filter, AccumulationCycleTracker, AccReporter (telemetry port), AccTickContext (tick input contract) (+49 more)

### Community 2 - "Risk Engine + Sizing + State"
Cohesion: 0.08
Nodes (31): averageCost(), buildRiskContext(), committedOpenSellQty(), dailyBuyUsed(), dailySellUsed(), startOfUtcDay(), RiskEngine, cfg (+23 more)

### Community 3 - "Config Contract + Auth UI"
Cohesion: 0.06
Nodes (53): boolFlag env-boolean pattern, Config validation tests, EnvSchema (zod config contract), getConfig (memoized singleton), Exchange API keys are session credentials, not config, OPERATOR_TOKEN fail-closed control plane, Harvest driver only runs in PAPER_MODE, parseConfig (+45 more)

### Community 4 - "Soak Control + Harvest Cycles"
Cohesion: 0.07
Nodes (46): SoakController (Telegram-driven soak lifecycle), Settings frozen while a soak runs, CycleTracker (harvest round-trips), Completed cycles, not realized PnL, as the success metric, FIFO rebuy matching without price re-gating, Intent-anchored sell bucket occupancy, priceBucketId (geometric price bucketing), FillLedger (append-only financial truth) (+38 more)

### Community 5 - "Market Ingestion + Orderbook"
Cohesion: 0.06
Nodes (13): buildBybitNormalizedState(), classifyVolatility(), BybitOrderbookMessage, BybitTradeMessage, BybitWebSocketClient, MexcRestDepth, MexcRestPoller, MarketIngestionPipeline (+5 more)

### Community 6 - "Control-Plane API + Audit"
Cohesion: 0.06
Nodes (26): AuditAction, AuditLog, AuditRecord, ApiServer, ApiServerOptions, clientIp(), DashboardAccountState, DashboardBalance (+18 more)

### Community 7 - "Treasury Ledger + Chaos Harness"
Cohesion: 0.11
Nodes (20): check(), exFill(), exOrder(), fillEvent(), log, mockClient(), req(), run() (+12 more)

### Community 8 - "Execution Adapters (paper/real)"
Cohesion: 0.09
Nodes (12): EventSink, ExecutionAdapter, PlaceAck, PaperEngine, PaperRealism, PriceProvider, TopOfBook, BybitExecutionAdapter (+4 more)

### Community 9 - "Shared Domain Types"
Cohesion: 0.07
Nodes (30): ExchangeBalance, ExchangeConnectorHealth, ExchangeFill, ExchangeOrder, OrderSide, OrderStatus, ExecutionOrder, ExecutionRequest (+22 more)

### Community 10 - "README Architecture Doctrine"
Cohesion: 0.07
Nodes (33): Authority Model, Build Roadmap (phases), Core Objective (harvest volatility safely), Engineering Principles, Operational Modes table, Repository Structure, SystemHeader component, TreasuryPanel component (+25 more)

### Community 11 - "Zone Manager (classify + policy)"
Cohesion: 0.15
Nodes (20): classifyZone(), ZoneChangeHandler, NO_ACTIONS, decideZone(), NONE, a, above, b (+12 more)

### Community 12 - "WebSocket Base Client"
Cohesion: 0.12
Nodes (16): BaseWebSocketConfig, clearHeartbeat(), clearPongTimer(), clearStaleTimer(), clearTimers(), connect(), destroy(), markSequenceGap() (+8 more)

### Community 13 - "Order Lifecycle + Store"
Cohesion: 0.13
Nodes (7): canTransition(), isTerminal(), TRANSITIONS, isMissingTable(), OrderStore, TERMINAL, OrderRegistry

### Community 14 - "Accumulation Cycle Tracker"
Cohesion: 0.14
Nodes (12): AccumulationCycleTracker, AccBuyInfo, AccRecoveryInfo, recoverySellQty(), recoveryTargetPrice(), AccumulationCycle, AccumulationCycleStatus, AccumulationMetrics (+4 more)

### Community 15 - "MEXC Protobuf Decoding"
Cohesion: 0.11
Nodes (11): DecodedDeal, DecodedDepth, DecodedMessage, decodeMexcMessage(), DepthLevel, Long, Wrapper, WrapperMessage (+3 more)

### Community 16 - "Soak v2 Test Harness"
Cohesion: 0.1
Nodes (17): PipelineDecision, baseParams, cyc, engine, events, fillEv, free, fresh (+9 more)

### Community 18 - "Account State Panel (UI)"
Cohesion: 0.14
Nodes (8): ExchangeKey, Props, statusClass, DashboardAccountState, DashboardBalance, DashboardFill, DashboardOrder, DashboardReconciliation

### Community 19 - "Execution Authority Components"
Cohesion: 0.13
Nodes (18): ExecutionAdapter, Async fill delivery mirrors exchange WS, detectDrift, Pure deterministic drift detection, Order state machine TRANSITIONS, canTransition, Explicit validated transitions are sole truth, OrderReconciler (+10 more)

### Community 21 - "Zod Env Config Loader"
Cohesion: 0.14
Nodes (14): Config, EnvSchema, getConfig(), getOperationalMode(), nonnegativeNumber, nonnegativePct, OperationalMode, OperationalModeSchema (+6 more)

### Community 23 - "Accumulation Test Harness"
Cohesion: 0.14
Nodes (12): AccReporter, AccumulationParams, allowAcc, b, b2, c, h, log (+4 more)

### Community 24 - "Dashboard Shell + Auth UI"
Cohesion: 0.18
Nodes (10): Dashboard(), AccountStatePanel(), SignInPage(), SignInPageProps, modeColor, Props, SystemHeader(), ConnectionStatus (+2 more)

### Community 26 - "App User Store (dashboard auth)"
Cohesion: 0.23
Nodes (5): AppUserStore, clearSessionCookie(), CreatedUser, sessionCookie(), tokenHash()

### Community 28 - "Telegram Command Plumbing"
Cohesion: 0.27
Nodes (5): SoakControllerDeps, CommandHandler, CommandReply, TgUpdate, TelegramNotifier

### Community 29 - "Trading Session (credentials)"
Cohesion: 0.24
Nodes (3): Credentials, SessionStatus, TradingSession

### Community 30 - "Soak Settings + Zone Config"
Cohesion: 0.24
Nodes (7): CONSERVATIVE, DEFAULT_ALLOW, PaperSoakDeps, SoakSettings, zoneBands(), zoneBehavior(), ZoneChangeEvent

### Community 31 - "Execution Pipeline + Driver Params"
Cohesion: 0.2
Nodes (5): AccTickContext, ExecutionPipeline, Backoff, HarvestParams, ZoneView

### Community 33 - "Exchange Card (UI)"
Cohesion: 0.27
Nodes (9): ExchangeCard(), fmt(), fmtBps(), fmtFreshness(), Props, regimeBadge, statusColor, statusText (+1 more)

### Community 34 - "Accumulation Budget"
Cohesion: 0.33
Nodes (3): AccumulationBudget, BudgetSnapshot, startOfUtcDay()

### Community 35 - "Treasury Panel (UI)"
Cohesion: 0.33
Nodes (7): fmtAmount(), fmtPrice(), fmtUsd(), pnlColor(), Props, TreasuryPanel(), DashboardTreasury

### Community 37 - "Engine Bootstrap + DB Client"
Cohesion: 0.5
Nodes (6): connectDatabase(), disconnectDatabase(), getPrisma(), buildRiskConfig(), log, main()

### Community 38 - "Payload Sanitization"
Cohesion: 0.29
Nodes (7): CredentialInput, finitePositive(), OrderInput, validateCredentialBody(), validateExchangeOnly(), validateOrderBody(), ValidationResult

### Community 46 - "Community 46"
Cohesion: 0.29
Nodes (5): EventLog(), levelStyle, levelTag, Props, DashboardEvent

### Community 47 - "Community 47"
Cohesion: 0.33
Nodes (7): State recovered from exchange truth before execution gate opens, StateRecovery, AuthenticatedExchangeClient, Authenticated client exposes REST clients, never raw keys, SessionManager, Raw credentials live only inside session, never serialized or logged, TradingSession

### Community 48 - "Community 48"
Cohesion: 0.47
Nodes (4): CycleMetrics, CycleStatus, HarvestCycle, VirtualAccountOptions

### Community 49 - "Community 49"
Cohesion: 0.33
Nodes (5): DerivedTreasury, DeriveTreasuryOptions, InventoryPool, TreasuryInventory, TreasurySnapshot

### Community 50 - "Community 50"
Cohesion: 0.4
Nodes (4): ExecutionPanel(), Props, statusColor, DashboardManagedOrder

### Community 51 - "Community 51"
Cohesion: 0.4
Nodes (5): BybitWebSocketClient, decodeMexcMessage (protobuf decoder), MEXC v3 WS migrated to protobuf Aug 2025, MexcWebSocketClient, REST seed before first protobuf delta

### Community 52 - "Community 52"
Cohesion: 0.5
Nodes (3): ExchangeChoice, SessionPanel(), SessionStatus

### Community 54 - "Community 54"
Cohesion: 0.67
Nodes (4): BybitRestClient, sanitizeHttpError, Strip axios config so API keys never leak into logs, MexcRestClient

### Community 55 - "Community 55"
Cohesion: 0.5
Nodes (4): CredentialCrypto, AES-256-GCM authenticated credential encryption, ExchangeClientFactory, Only place credentials are read

### Community 56 - "Community 56"
Cohesion: 0.5
Nodes (4): FILL_RECEIVED dedup by fillId; balances/orders full-replace exchange truth, reduce, Reducer returns same ref when unchanged to skip event emission, StateEngine

### Community 60 - "Community 60"
Cohesion: 1.0
Nodes (3): MexcRestPoller, MarketIngestionPipeline, OrderbookEngine

### Community 61 - "Community 61"
Cohesion: 0.67
Nodes (3): reserveFloor splits totalBase into active vs reserve inventory, Pure deterministic derivation; weighted-avg cost basis; state reconstructable from fills, deriveTreasury

### Community 62 - "Community 62"
Cohesion: 0.67
Nodes (3): BaseWebSocketClient, Sequence state machine: monotonic increase only, not strict +1; avoids reconnect loops, Heartbeat/pong/stale timers detect silent websocket desync and force reconnect

## Ambiguous Edges - Review These
- `RiskEngine` → `RiskError`  [AMBIGUOUS]
  backend/src/decision-gate/errors/risk-error.ts · relation: conceptually_related_to
- `ZoneManager service` → `Zone/accumulation block reason codes`  [AMBIGUOUS]
  docs/PHASE_ZONE_ACCUMULATION.md · relation: conceptually_related_to

## Knowledge Gaps
- **274 isolated node(s):** `backendDir`, `repoRoot`, `log`, `BudgetSnapshot`, `AccumulationCycleStatus` (+269 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **45 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `RiskEngine` and `RiskError`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `ZoneManager service` and `Zone/accumulation block reason codes`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `ReconciliationEngine` connect `Exchange REST + Reconciliation` to `Engine Bootstrap + DB Client`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Why does `classifyDrift()` connect `Shared Domain Types` to `Exchange REST + Reconciliation`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Why does `OrderRegistry` connect `Order Lifecycle + Store` to `Exchange REST + Reconciliation`, `Risk Engine + Sizing + State`, `Engine Bootstrap + DB Client`, `Treasury Ledger + Chaos Harness`, `Soak v2 Test Harness`, `Telegram Command Plumbing`, `Soak Settings + Zone Config`, `Execution Pipeline + Driver Params`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **What connects `backendDir`, `repoRoot`, `log` to the rest of the system?**
  _274 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Exchange REST + Reconciliation` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._