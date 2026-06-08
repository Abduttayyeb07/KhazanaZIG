import { getConfig } from "@zig/config";
import { createLogger } from "@zig/logger";
import type { Exchange } from "@zig/shared-types";

import { StateEngine } from "./state-engine/index.js";
import { ModeController } from "./decision-gate/mode-controller.js";
import { MarketIngestionPipeline } from "./market-ingestion/pipeline.js";
import { StateRecovery } from "./state/recovery.js";
import { ReconciliationEngine } from "./reconciliation/engine.js";
import { OrderRegistry } from "./execution-engine/registry.js";
import { OrderStore } from "./execution-engine/order-store.js";
import { OrderReconciler } from "./execution-engine/order-reconciler.js";
import { PaperEngine } from "./execution-engine/paper-engine.js";
import { ExecutionPipeline } from "./execution-engine/pipeline.js";
import { BybitExecutionAdapter, MexcExecutionAdapter, RealExecutionRouter } from "./execution-engine/real-adapter.js";
import { RiskEngine } from "./decision-gate/risk-engine.js";
import { buildRiskConfig } from "./decision-gate/risk-config.js";
import type { ExecutionRequest, ExchangeFill, OrderEvent, ManagedOrder } from "@zig/shared-types";
import { randomUUID } from "crypto";
import { ExchangeClientFactory } from "./session/exchange-client-factory.js";
import { CredentialCrypto } from "./session/crypto.js";
import { CredentialStore } from "./session/credential-store.js";
import { SessionManager, type AuthenticatedExchangeClient } from "./session/session-manager.js";
import { getPrisma, connectDatabase, disconnectDatabase } from "./database/client.js";
import { TreasuryEngine } from "./treasury/engine.js";
import { TelegramNotifier } from "./telegram/notifier.js";
import { ApiServer } from "./api/server.js";
import { SoakController } from "./paper-soak/controller.js";
import { TelegramCommandListener } from "./telegram/command-listener.js";
import type { DashboardPayload } from "./api/server.js";
import { AuditLog } from "./api/audit.js";
import { validateCredentialBody, validateExchangeOnly, validateOrderBody } from "./api/middleware/sanitize-body.js";

const log = createLogger("core-engine");

async function main() {
  const cfg = getConfig();
  const startedAt = Date.now();
  log.info({ mode: cfg.OPERATIONAL_MODE, symbol: cfg.TRADING_SYMBOL }, "Core engine starting");

  // ── 1. Telegram ───────────────────────────────────────────────────────────
  const tg = new TelegramNotifier(cfg.TELEGRAM_BOT_TOKEN, cfg.TELEGRAM_CHAT_ID, log);

  // ── 2. API Server (control-plane: operator token + audit + rate limit) ───
  const audit = new AuditLog(log);
  const api = new ApiServer(log, {
    operatorToken: cfg.OPERATOR_TOKEN,
    dashboardOrigin: cfg.DASHBOARD_ORIGIN,
    audit,
  });

  // ── 3. State Engine + Mode Controller ─────────────────────────────────────
  const stateEngine = new StateEngine(log);
  const modeController = new ModeController(cfg.OPERATIONAL_MODE, stateEngine, log);
  const riskEngine = new RiskEngine(buildRiskConfig(cfg));

  // ── 4. Database + Session layer ───────────────────────────────────────────
  const dbConnected = await connectDatabase(log);
  const crypto = new CredentialCrypto(cfg.ENCRYPTION_KEY, log);
  const credentialStore = new CredentialStore(getPrisma(), crypto, log);
  const sessionManager = new SessionManager(credentialStore, log, crypto.isEphemeral);

  let sessionActive = false;
  let reconciler: ReconciliationEngine | null = null;
  let soakController: SoakController | null = null;
  let cmdListener: TelegramCommandListener | null = null;

  // ── 4b. Treasury accounting engine (derives financial state from fills) ───
  const treasury = new TreasuryEngine(
    dbConnected ? getPrisma() : null,
    { baseAsset: cfg.BASE_ASSET, quoteAsset: cfg.QUOTE_ASSET, reserveFloor: cfg.RESERVE_FLOOR },
    log
  );
  await treasury.init(); // load durable fill ledger (reconstruction baseline)

  // Latest ZIG mark price — prefer Bybit mid, else MEXC mid.
  const markPrice = (): number | null => {
    const s = stateEngine.getState();
    return s.market.bybit?.midPrice ?? s.market.mexc?.midPrice ?? null;
  };

  // ── 5. Market data WebSockets (public — no credentials) ──────────────────
  const factory = new ExchangeClientFactory(log);
  const bybitWs = factory.createBybitWebSocket(cfg.TRADING_SYMBOL);
  const mexcWs = factory.createMexcWebSocket(cfg.TRADING_SYMBOL);

  bybitWs.on("connected", () => { api.addEvent("info", "Bybit WebSocket connected"); broadcastState(); });
  bybitWs.on("disconnected", ({ code }: { code: number }) => { api.addEvent("warn", `Bybit WS disconnected (${code})`); broadcastState(); });
  bybitWs.on("staleStream", ({ staleMs }: { staleMs: number }) => api.addEvent("warn", `Bybit stale ${staleMs}ms`));

  mexcWs.on("connected", () => { api.addEvent("info", "MEXC WebSocket connected"); broadcastState(); });
  mexcWs.on("disconnected", ({ code }: { code: number }) => { api.addEvent("warn", `MEXC WS disconnected (${code})`); broadcastState(); });
  mexcWs.on("staleStream", ({ staleMs }: { staleMs: number }) => api.addEvent("warn", `MEXC stale ${staleMs}ms`));

  // ── 6. Market Ingestion ───────────────────────────────────────────────────
  const ingestion = new MarketIngestionPipeline(bybitWs, mexcWs, cfg.TRADING_SYMBOL, stateEngine, log);
  ingestion.start();

  // ── 7. Execution Engine (Phase 4 — PAPER_MODE only; no real adapter yet) ──
  const orderStore = new OrderStore(dbConnected ? getPrisma() : null, log);
  const orderRegistry = new OrderRegistry(log, orderStore);
  const orderReconciler = new OrderReconciler(orderRegistry, cfg.TRADING_SYMBOL, log);

  // Rebuild the registry from the durable store so idempotency + recovery survive
  // a restart. These are real, non-terminal orders; exchange-truth reconciliation
  // runs once a session is authenticated (below).
  if (dbConnected) {
    orderRegistry.hydrate(await orderStore.loadActive());
  }

  const paperEngine = new PaperEngine(
    (ev) => orderRegistry.applyEvent(ev),
    (ex) => {
      const m = stateEngine.getState().market[ex];
      return m && m.bestBid !== null && m.bestAsk !== null ? { bestBid: m.bestBid, bestAsk: m.bestAsk } : null;
    },
    log,
    { slippageBps: cfg.PAPER_SLIPPAGE_BPS, fillProbability: cfg.PAPER_FILL_PROBABILITY }
  );
  // realAdapter is null until Phase 4 Week 3 — NORMAL mode will reject placement.
  const pipeline = new ExecutionPipeline(
    stateEngine,
    orderRegistry,
    paperEngine,
    null,
    riskEngine,
    (decision) => {
      modeController.halt(`RISK_ENGINE_HALT: ${decision.reasons.join(", ")}`, "risk_engine");
      api.addEvent("error", `Risk halt: ${decision.reasons.join(", ")}`);
    },
    log
  );

  // ── 7b. Paper soak (live-market forward test) — Telegram-controlled ──────
  // The soak controller owns the virtual account + harvest driver and is driven
  // by Telegram commands (/soak_start flips the engine into PAPER_MODE; /soak_stop
  // returns it to READ_ONLY). The harvest driver paper-trades only — it can never
  // originate intents against real funds.
  if (cfg.TELEGRAM_BOT_TOKEN && cfg.TELEGRAM_CHAT_ID) {
    soakController = new SoakController({
      cfg, stateEngine, pipeline, registry: orderRegistry, modeController, tg, markFn: markPrice, log,
    });
    cmdListener = new TelegramCommandListener(
      cfg.TELEGRAM_BOT_TOKEN, cfg.TELEGRAM_CHAT_ID, cfg.TELEGRAM_ALLOWED_USER_IDS, tg, log
    );
    soakController.register(cmdListener);
  } else {
    log.warn("Telegram not configured — soak control + reporting unavailable");
  }

  // A confirmed REAL fill flows into FILL_RECEIVED → treasury ledger + account state.
  // PAPER fills are simulation artifacts: they stay ONLY in the execution view
  // (the managed order's filledQuantity). They must never appear in the Treasury
  // or Account State panels, which reflect real exchange truth only.
  orderRegistry.on("fill", (ev: OrderEvent, order: ManagedOrder) => {
    if (ev.fillId?.startsWith("PAPER-")) {
      soakController?.onPaperFill(ev, order); // virtual account + soak Telegram report
      broadcastState(); // refresh the execution view, nothing else
      return;
    }
    const fill: ExchangeFill = {
      exchange: order.exchange,
      fillId: ev.fillId ?? `${order.clientOrderId}-${ev.at}`,
      orderId: ev.exchangeOrderId ?? order.clientOrderId,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side,
      price: ev.fillPrice ?? order.price,
      size: ev.fillQuantity ?? 0,
      fee: ev.fee ?? 0,
      feeAsset: ev.feeAsset ?? cfg.QUOTE_ASSET,
      filledAt: ev.at,
    };
    stateEngine.dispatch({ type: "FILL_RECEIVED", exchange: order.exchange, fill, source: "execution-engine" });
  });

  // Execution journal → operational event feed.
  orderRegistry.on("event", (ev: OrderEvent, order: ManagedOrder) => {
    api.addEvent("info", `[EXEC] ${ev.type} ${order.side} ${order.quantity}@${order.price} (${order.status})`);
    broadcastState();
  });

  // ── 8. Authenticated services: recovery + reconciliation ─────────────────
  // Runs when a session is established (startup if creds exist, or on submit).
  async function enableAuthenticatedServices(authClient: AuthenticatedExchangeClient): Promise<void> {
    sessionActive = true;

    // State recovery — exchange truth → state engine
    const recovery = new StateRecovery(authClient, cfg.TRADING_SYMBOL, log);
    const recovered = await recovery.recover();

    for (const ex of ["bybit", "mexc"] as Exchange[]) {
      const r = recovered[ex];
      stateEngine.dispatch({ type: "BALANCES_UPDATED", exchange: ex, balances: r.balances, source: "state-recovery" });
      stateEngine.dispatch({ type: "OPEN_ORDERS_UPDATED", exchange: ex, orders: r.openOrders, source: "state-recovery" });
      for (const fill of r.recentFills) {
        stateEngine.dispatch({ type: "FILL_RECEIVED", exchange: ex, fill, source: "reconciliation" });
      }
    }

    // Feed recovered fills into the treasury ledger (append-only, dedup)
    const recoveredFills = [...stateEngine.getState().fills.bybit, ...stateEngine.getState().fills.mexc];
    await treasury.ingest(recoveredFills);

    // Crash recovery: rebuild any live managed orders from exchange truth. Real
    // fills found during recovery flow into FILL_RECEIVED (treasury dedups).
    await orderReconciler.reconcile(authClient, (fill) => {
      stateEngine.dispatch({ type: "FILL_RECEIVED", exchange: fill.exchange, fill, source: "reconciliation" });
    });

    api.addEvent("info", "Authenticated state recovery complete");

    // Wire REAL execution adapters from the authenticated clients. Real orders
    // only ever execute in NORMAL/DEFENSIVE mode (enforced by the pipeline's mode
    // gate); in PAPER_MODE the paper engine is used regardless.
    const realRouter = new RealExecutionRouter(
      authClient.bybit ? new BybitExecutionAdapter(authClient.bybit, (ev) => orderRegistry.applyEvent(ev), log) : null,
      authClient.mexc ? new MexcExecutionAdapter(authClient.mexc, (ev) => orderRegistry.applyEvent(ev), log) : null
    );
    pipeline.setRealAdapter(realRouter);

    // (Re)start reconciliation on the new authenticated client
    reconciler?.stop();
    reconciler = new ReconciliationEngine(
      authClient,
      cfg.TRADING_SYMBOL,
      stateEngine,
      dbConnected ? getPrisma() : null,
      log
    );
    reconciler.start(5 * 60 * 1_000, (result) => {
      stateEngine.dispatch({ type: "RECONCILIATION_DONE", result, source: "reconciliation" });

      if (result.requiresExecutionHalt) {
        modeController.halt(`CRITICAL drift on ${result.exchange}`, "risk_engine");
      }

      const level = result.status === "MATCH" ? "info" : result.status === "CRITICAL_DRIFT" ? "error" : "warn";
      api.addEvent(level, `Reconciliation ${result.exchange.toUpperCase()}: ${result.status} (${result.issues.length} issues)`);

      const icon = result.status === "MATCH" ? "✅" : result.status === "CRITICAL_DRIFT" ? "🛑" : "⚠️";
      tg.notify(
        `📊 <b>Reconciliation</b> — ${result.exchange.toUpperCase()}\n` +
        `Status: ${icon} <code>${result.status}</code>\n` +
        `Issues: ${result.issues.length} | Repaired: ${result.repaired}` +
        (result.requiresExecutionHalt ? `\n🛑 <b>EXECUTION HALTED</b>` : "")
      );
      broadcastState();
    });

    broadcastState();
  }

  // ── 9. Try to establish a session from stored credentials at startup ──────
  if (dbConnected) {
    try {
      const authClient = await sessionManager.establishFromStore();
      if (authClient) {
        api.addEvent("info", "Session established from stored credentials");
        await enableAuthenticatedServices(authClient);
      } else {
        api.addEvent("info", "No stored credentials — market-data-only mode");
      }
    } catch (err) {
      log.error({ err }, "Failed to establish session from store");
    }
  } else {
    api.addEvent("warn", "Database unavailable — credential persistence disabled");
  }

  stateEngine.dispatch({ type: "RECOVERY_COMPLETE", source: "state-recovery" });

  // ── 10. API routes ────────────────────────────────────────────────────────
  // PUBLIC (read-only, no secrets exposed) — open on the bound interface
  api.route("GET", "/api/public/session-status", async ({ send }) => {
    send(200, await sessionManager.status());
  });

  // OPERATOR (control plane) — /api/operator/* auto-requires operator token,
  // rate limiting, and is audit-logged centrally by the ApiServer.
  api.route("POST", "/api/operator/credentials", async ({ body, ip, send }) => {
    if (!dbConnected) return send(503, { error: "Database unavailable — cannot persist credentials" });

    const v = validateCredentialBody(body);
    if (!v.ok) {
      audit.record({ action: "CREDENTIALS_SUBMIT", ip, success: false, detail: v.error });
      return send(400, { error: v.error });
    }

    await sessionManager.submitCredentials(v.value.exchange, { apiKey: v.value.apiKey, apiSecret: v.value.apiSecret }, v.value.label);
    const authClient = sessionManager.getAuthenticatedClient();
    if (authClient) await enableAuthenticatedServices(authClient);

    audit.record({ action: "CREDENTIALS_SUBMIT", ip, success: true, exchange: v.value.exchange });
    api.addEvent("info", `Credentials submitted for ${v.value.exchange.toUpperCase()}`);
    tg.notify(`🔑 <b>Credentials added</b> for ${v.value.exchange.toUpperCase()} — session active`);
    send(200, { ok: true, status: await sessionManager.status() });
  });

  api.route("DELETE", "/api/operator/credentials", async ({ body, ip, send }) => {
    const v = validateExchangeOnly(body);
    if (!v.ok) {
      audit.record({ action: "CREDENTIALS_DELETE", ip, success: false, detail: v.error });
      return send(400, { error: v.error });
    }
    await sessionManager.removeCredentials(v.value.exchange);

    // Clear the now-orphaned account state so the dashboard stops showing stale
    // balances/orders/fills for an exchange we can no longer authenticate.
    stateEngine.dispatch({ type: "ACCOUNT_CLEARED", exchange: v.value.exchange, source: "session-manager" });

    // Re-evaluate authenticated services: rebuild on remaining creds, or fully
    // tear down (stop reconciliation, mark session inactive) if none remain.
    const remaining = sessionManager.getAuthenticatedClient();
    if (remaining) {
      await enableAuthenticatedServices(remaining);
    } else {
      reconciler?.stop();
      reconciler = null;
      sessionActive = false;
      pipeline.setRealAdapter(null); // no auth → real placement disabled (fail-safe)
    }

    audit.record({ action: "CREDENTIALS_DELETE", ip, success: true, exchange: v.value.exchange });
    api.addEvent("warn", `Credentials removed for ${v.value.exchange.toUpperCase()} — account state cleared`);
    broadcastState();
    send(200, { ok: true, status: await sessionManager.status() });
  });

  // OPERATOR — place a limit order through the execution pipeline. In PAPER_MODE
  // it simulates; in NORMAL it would route to the real adapter (Week 3). READ_ONLY
  // / HALT are rejected at the mode gate inside the pipeline.
  api.route("POST", "/api/operator/order", async ({ body, ip, send }) => {
    const v = validateOrderBody(body);
    if (!v.ok) {
      audit.record({ action: "ORDER_PLACE", ip, success: false, detail: v.error });
      return send(400, { error: v.error });
    }
    const req: ExecutionRequest = {
      requestId: randomUUID(),
      exchange: v.value.exchange,
      symbol: cfg.TRADING_SYMBOL,
      side: v.value.side,
      type: "LIMIT",
      quantity: v.value.quantity,
      price: v.value.price,
      tif: "GTC",
      source: "OPERATOR",
      reason: v.value.reason,
      createdAt: Date.now(),
    };
    const result = await pipeline.submit(req);
    if (result.risk) {
      const level = result.risk.decision === "ALLOW" ? "info" : result.risk.decision === "HALT" ? "error" : "warn";
      api.addEvent(
        level,
        `Risk ${result.risk.decision}: requested ${result.risk.requestedQty}, approved ${result.risk.approvedQty} (${result.risk.reasons.join(", ")})`
      );
    }
    audit.record({
      action: "ORDER_PLACE",
      ip,
      success: result.accepted,
      exchange: v.value.exchange,
      detail: result.accepted ? `${v.value.side} ${v.value.quantity}@${v.value.price}` : `${result.stage}: ${result.reason}`,
    });
    if (!result.accepted) return send(409, { error: result.reason, stage: result.stage, risk: result.risk });
    send(200, { ok: true, clientOrderId: result.clientOrderId, status: result.order.status, risk: result.risk });
  });

  // OPERATOR — cancel a managed order by clientOrderId.
  api.route("DELETE", "/api/operator/order", async ({ body, ip, send }) => {
    const b = body as { clientOrderId?: string };
    if (typeof b?.clientOrderId !== "string") {
      return send(400, { error: "clientOrderId (string) required" });
    }
    const ok = await pipeline.cancel(b.clientOrderId);
    audit.record({ action: "ORDER_CANCEL", ip, success: ok, detail: b.clientOrderId });
    if (!ok) return send(404, { error: "Unknown order" });
    send(200, { ok: true });
  });

  // Execution-sync loop — real exchanges deliver fills asynchronously. While we
  // have open REAL orders and an authenticated session, poll exchange truth to
  // detect fills/cancels and drive the order lifecycle. (Private WS order streams
  // are a future optimization; polling is correct for a treasury, not HFT.)
  setInterval(() => {
    if (!sessionActive) return;
    const hasOpenReal = orderRegistry.openOrders().some((o) => !o.paper);
    if (!hasOpenReal) return;
    const client = sessionManager.getAuthenticatedClient();
    if (!client) return;
    void orderReconciler
      .reconcile(client, (fill) => {
        stateEngine.dispatch({ type: "FILL_RECEIVED", exchange: fill.exchange, fill, source: "reconciliation" });
      })
      .catch((err) => log.warn({ err }, "execution-sync reconcile failed"));
  }, 8_000);

  api.start(cfg.API_HOST, cfg.API_PORT);

  // Begin listening for Telegram commands (/soak_start, /status, ...).
  cmdListener?.start();
  // Optional auto-start at boot (PAPER_SOAK_ENABLED). The controller flips the
  // engine into PAPER_MODE itself, so this never touches real funds.
  if (soakController && cfg.PAPER_SOAK_ENABLED) {
    void soakController.start((t) => tg.notify(t));
  }

  // ── 11. State broadcast ───────────────────────────────────────────────────
  // Market updates also drive the paper engine — resting paper orders fill when
  // the live book crosses their limit.
  stateEngine.on("MARKET_STATE_UPDATED", () => { paperEngine.tick(); broadcastState(); });
  stateEngine.on("MODE_CHANGED", () => {
    api.addEvent("warn", `Mode changed to ${stateEngine.getState().mode}`);
    broadcastState();
  });
  // New fills → durable ledger → re-derive treasury → broadcast
  stateEngine.on("FILL_RECEIVED", (state) => {
    const allFills = [...state.fills.bybit, ...state.fills.mexc];
    void treasury.ingest(allFills).then((changed) => {
      if (changed) broadcastState();
    });
  });

  // Durable treasury snapshots every 5 min (history graph + audit baseline)
  treasury.startSnapshots(5 * 60 * 1_000, markPrice);

  function broadcastState(): void {
    const state = stateEngine.getState();
    const bybit = state.market.bybit;
    const mexc = state.market.mexc;
    const wsState = (ws: { connectionState: string }) =>
      ws.connectionState === "CONNECTED" ? "CONNECTED" :
      ws.connectionState === "RECONNECTING" ? "RECONNECTING" : "DISCONNECTED";

    const payload: DashboardPayload = {
      mode: state.mode,
      hasSession: sessionActive,
      symbol: cfg.TRADING_SYMBOL,
      exchanges: {
        bybit: {
          wsStatus: wsState(bybitWs) as "CONNECTED" | "RECONNECTING" | "DISCONNECTED",
          bestBid: bybit?.bestBid ?? null, bestAsk: bybit?.bestAsk ?? null,
          spread: bybit?.spread ?? null, spreadBps: bybit?.spreadBps ?? null,
          midPrice: bybit?.midPrice ?? null, imbalanceRatio: bybit?.imbalanceRatio ?? null,
          regime: bybit?.volatilityRegime ?? null, freshnessMs: bybit?.orderbookFreshnessMs ?? null,
        },
        mexc: {
          wsStatus: wsState(mexcWs) as "CONNECTED" | "RECONNECTING" | "DISCONNECTED",
          bestBid: mexc?.bestBid ?? null, bestAsk: mexc?.bestAsk ?? null,
          spread: mexc?.spread ?? null, spreadBps: mexc?.spreadBps ?? null,
          midPrice: mexc?.midPrice ?? null, imbalanceRatio: mexc?.imbalanceRatio ?? null,
          regime: mexc?.volatilityRegime ?? null, freshnessMs: mexc?.orderbookFreshnessMs ?? null,
        },
      },
      account: {
        balances: state.balances,
        openOrders: state.openOrders,
        fills: state.fills,
        reconciliation: state.lastReconciliation,
      },
      treasury: treasury.derive(markPrice()),
      execution: {
        managedOrders: orderRegistry.all().map((o) => ({
          clientOrderId: o.clientOrderId,
          exchange: o.exchange,
          side: o.side,
          price: o.price,
          quantity: o.quantity,
          filledQuantity: o.filledQuantity,
          status: o.status,
          source: o.source,
          reason: o.reason,
          createdAt: o.createdAt,
        })),
      },
      events: api.getEvents(),
      startedAt,
      updatedAt: Date.now(),
    };
    api.broadcast(payload);
  }

  // ── 12. Graceful shutdown ─────────────────────────────────────────────────
  async function shutdown(signal: string) {
    log.warn({ signal }, "[CRITICAL] Shutdown signal received");
    api.addEvent("error", `Engine stopping: ${signal}`);
    broadcastState();
    tg.notify(`🔴 <b>Core engine stopping</b>\nSignal: ${signal}`);
    modeController.halt(`Shutdown: ${signal}`, "system");
    cmdListener?.stop();
    soakController?.stop(() => undefined);
    reconciler?.stop();
    treasury.stop();
    ingestion.stop();
    sessionManager.destroy();
    await disconnectDatabase();
    log.info("Core engine stopped cleanly");
    setTimeout(() => process.exit(0), 500);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  log.info({ mode: modeController.mode, symbol: cfg.TRADING_SYMBOL, sessionActive }, "Core engine running");
  api.addEvent("info", `Engine started — mode: ${cfg.OPERATIONAL_MODE}`);
  broadcastState();

  tg.notify(
    `🟢 <b>ZIG KHAZANA Core Engine started</b>\n` +
    `Mode: <code>${cfg.OPERATIONAL_MODE}</code>\n` +
    `Symbol: <code>${cfg.TRADING_SYMBOL}</code>\n` +
    `Session: ${sessionActive ? "Active" : "None"}\n` +
    (soakController ? `\nSend <code>/help</code> for paper-soak commands.` : `Dashboard: http://localhost:3000`)
  );
}

main().catch((err) => {
  log.fatal({ err }, "Core engine fatal error");
  process.exit(1);
});
