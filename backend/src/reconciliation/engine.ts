import type { PrismaClient } from "@prisma/client";
import type { Logger } from "@zig/logger";
import type { ReconciliationResult, DriftIssue, Exchange } from "@zig/shared-types";
import { classifyDrift } from "@zig/shared-types";
import type { AuthenticatedExchangeClient } from "../session/session-manager.js";
import type { BybitRestClient } from "../exchange/bybit/rest.js";
import type { MexcRestClient } from "../exchange/mexc/rest.js";
import type { StateEngine } from "../state-engine/index.js";
import { detectDrift, type ExchangeSnapshot, type LocalView } from "./drift-detector.js";

// ── Reconciliation Engine ──────────────────────────────────────────────────────
//
// Financial consensus loop. Per exchange, each cycle:
//   1. Fetch exchange truth (balances, open orders, fills)
//   2. Read local view from the StateEngine
//   3. Detect + classify drift (pure)
//   4. Repair: exchange truth wins for balances/orders (full replace);
//      missing fills are appended (dedup by fillId in the reducer) — NEVER overwritten
//   5. Persist a ReconciliationReport (durability/audit; DB is not the truth authority)
//
// CRITICAL drift sets requiresExecutionHalt; the caller halts the mode controller.
// ──────────────────────────────────────────────────────────────────────────────

export class ReconciliationEngine {
  private readonly client: AuthenticatedExchangeClient;
  private readonly symbol: string;
  private readonly stateEngine: StateEngine;
  private readonly prisma: PrismaClient | null;
  private readonly log: Logger;
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(
    client: AuthenticatedExchangeClient,
    symbol: string,
    stateEngine: StateEngine,
    prisma: PrismaClient | null,
    log: Logger
  ) {
    this.client = client;
    this.symbol = symbol;
    this.stateEngine = stateEngine;
    this.prisma = prisma;
    this.log = log.child({ module: "reconciliation" });
  }

  start(intervalMs: number, onResult: (result: ReconciliationResult) => void): void {
    if (this.intervalHandle) return;
    this.log.info({ intervalMs }, "Reconciliation engine started");

    const run = async () => {
      try {
        const results = await this.runAll();
        for (const r of results) onResult(r);
      } catch (err) {
        this.log.error({ err }, "Reconciliation cycle failed");
      }
    };

    this.intervalHandle = setInterval(run, intervalMs);
    void run(); // run once immediately
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.log.info("Reconciliation engine stopped");
    }
  }

  async runAll(): Promise<ReconciliationResult[]> {
    const jobs: Promise<ReconciliationResult>[] = [];
    if (this.client.bybit) jobs.push(this.reconcile("bybit", this.client.bybit));
    if (this.client.mexc) jobs.push(this.reconcile("mexc", this.client.mexc));

    const settled = await Promise.allSettled(jobs);
    const results: ReconciliationResult[] = [];
    for (const s of settled) {
      if (s.status === "fulfilled") results.push(s.value);
    }
    return results;
  }

  private async reconcile(
    exchange: Exchange,
    client: BybitRestClient | MexcRestClient
  ): Promise<ReconciliationResult> {
    const timestamp = Date.now();

    // 1. Exchange truth
    const [balances, openOrders, fills] = await Promise.all([
      client.getBalances(),
      client.getOpenOrders(this.symbol),
      client.getRecentFills(this.symbol),
    ]);
    const snapshot: ExchangeSnapshot = { balances, openOrders, fills };

    // 2. Local view (operational truth in the state engine)
    const state = this.stateEngine.getState();
    const local: LocalView = {
      balances: state.balances[exchange],
      openOrders: state.openOrders[exchange],
      fills: state.fills[exchange],
    };

    // 3. Detect + classify
    const issues: DriftIssue[] = detectDrift(exchange, snapshot, local);
    const { status, requiresExecutionHalt } = classifyDrift(issues);

    // 4. Repair — exchange truth wins. Skip repair only on CRITICAL (needs operator
    //    attention; auto-overwriting impossible state could mask the problem).
    let repaired = false;
    if (status === "HARD_DRIFT") {
      this.stateEngine.dispatch({ type: "BALANCES_UPDATED", exchange, balances, source: "reconciliation" });
      this.stateEngine.dispatch({ type: "OPEN_ORDERS_UPDATED", exchange, orders: openOrders, source: "reconciliation" });
      for (const fill of fills) {
        // append + dedup (reducer drops duplicates by fillId) — never overwrites history
        this.stateEngine.dispatch({ type: "FILL_RECEIVED", exchange, fill, source: "reconciliation" });
      }
      repaired = true;
    }

    this.log.info(
      { exchange, status, issues: issues.length, requiresExecutionHalt, repaired },
      "Reconciliation cycle complete"
    );

    const result: ReconciliationResult = {
      timestamp,
      exchange,
      status,
      issues,
      requiresExecutionHalt,
      repaired,
    };

    await this.persist(result);
    return result;
  }

  // DB is a durability/audit layer, not the truth authority.
  private async persist(result: ReconciliationResult): Promise<void> {
    if (!this.prisma) return;
    try {
      await this.prisma.reconciliationReport.create({
        data: {
          exchange: result.exchange,
          status: result.status,
          issues: result.issues as unknown as object,
          requiresExecutionHalt: result.requiresExecutionHalt,
          repaired: result.repaired,
          timestamp: new Date(result.timestamp),
        },
      });
    } catch (err) {
      this.log.warn({ err }, "Failed to persist reconciliation report");
    }
  }
}
