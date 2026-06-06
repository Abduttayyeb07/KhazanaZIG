import type { Logger } from "@zig/logger";
import type { ExecutionRequest, ManagedOrder } from "@zig/shared-types";
import type { StateEngine } from "../state-engine/index.js";
import { RiskEngine } from "../decision-gate/risk-engine.js";
import type { RiskDecision } from "../decision-gate/risk-types.js";
import { OrderRegistry } from "./registry.js";
import type { ExecutionAdapter } from "./adapter.js";

export type PipelineDecision =
  | { accepted: true; clientOrderId: string; order: ManagedOrder; risk: RiskDecision }
  | { accepted: false; stage: "MODE" | "RISK" | "TREASURY" | "IDEMPOTENCY" | "ADAPTER"; reason: string; risk?: RiskDecision };

export class ExecutionPipeline {
  private readonly stateEngine: StateEngine;
  private readonly registry: OrderRegistry;
  private readonly paperAdapter: ExecutionAdapter;
  private realAdapter: ExecutionAdapter | null;
  private readonly riskEngine: RiskEngine;
  private readonly onRiskHalt: (decision: RiskDecision) => void;
  private readonly log: Logger;
  private readonly submitted = new Set<string>();

  constructor(
    stateEngine: StateEngine,
    registry: OrderRegistry,
    paperAdapter: ExecutionAdapter,
    realAdapter: ExecutionAdapter | null,
    riskEngine: RiskEngine,
    onRiskHalt: (decision: RiskDecision) => void,
    log: Logger
  ) {
    this.stateEngine = stateEngine;
    this.registry = registry;
    this.paperAdapter = paperAdapter;
    this.realAdapter = realAdapter;
    this.riskEngine = riskEngine;
    this.onRiskHalt = onRiskHalt;
    this.log = log.child({ module: "execution-pipeline" });
  }

  setRealAdapter(adapter: ExecutionAdapter | null): void {
    this.realAdapter = adapter;
    this.log.info({ hasRealAdapter: adapter !== null }, "Real execution adapter updated");
  }

  async submit(req: ExecutionRequest): Promise<PipelineDecision> {
    const state = this.stateEngine.getState();
    const risk = this.riskEngine.evaluate(req, state, this.registry.openOrders());

    this.log.info(
      {
        requestId: req.requestId,
        exchange: req.exchange,
        symbol: req.symbol,
        side: req.side,
        requestedQty: risk.requestedQty,
        approvedQty: risk.approvedQty,
        decision: risk.decision,
        reasons: risk.reasons,
        severity: risk.severity,
      },
      "Risk decision"
    );

    if (risk.decision === "HALT") {
      this.onRiskHalt(risk);
      return { accepted: false, stage: "RISK", reason: risk.reasons.join("; "), risk };
    }

    if (risk.decision === "REJECT") {
      return { accepted: false, stage: "RISK", reason: risk.reasons.join("; "), risk };
    }

    const finalReq = risk.decision === "REDUCE" ? { ...req, quantity: risk.approvedQty } : req;
    const clientOrderId = `zig-${finalReq.requestId}`;

    if (this.submitted.has(clientOrderId) || this.registry.has(clientOrderId)) {
      return { accepted: false, stage: "IDEMPOTENCY", reason: "Duplicate clientOrderId - already submitted", risk };
    }

    const usePaper = state.mode === "PAPER_MODE";
    const adapter = usePaper ? this.paperAdapter : this.realAdapter;
    if (!adapter) {
      return {
        accepted: false,
        stage: "ADAPTER",
        reason: "No real execution adapter (NORMAL/DEFENSIVE mode requires authenticated session)",
        risk,
      };
    }

    this.submitted.add(clientOrderId);
    const order = this.registry.register(finalReq, clientOrderId, usePaper);
    this.registry.transition(clientOrderId, "SUBMITTED");

    this.log.info(
      {
        requestId: finalReq.requestId,
        clientOrderId,
        side: finalReq.side,
        qty: finalReq.quantity,
        price: finalReq.price,
        mode: usePaper ? "PAPER" : "REAL",
        source: finalReq.source,
        reason: finalReq.reason,
      },
      "Execution request accepted - submitting to adapter"
    );

    try {
      const ack = await adapter.placeOrder(order);
      if (!ack.accepted) {
        this.registry.transition(clientOrderId, "REJECTED");
        return { accepted: false, stage: "ADAPTER", reason: ack.reason ?? "Adapter rejected order", risk };
      }
      return { accepted: true, clientOrderId, order, risk };
    } catch (err) {
      this.registry.transition(clientOrderId, "FAILED");
      this.log.error({ err, clientOrderId }, "Adapter placeOrder threw - order marked FAILED (may exist on exchange)");
      return {
        accepted: false,
        stage: "ADAPTER",
        reason: err instanceof Error ? err.message : "submit failed",
        risk,
      };
    }
  }

  async cancel(clientOrderId: string): Promise<boolean> {
    const order = this.registry.get(clientOrderId);
    if (!order) return false;

    const adapter = order.paper ? this.paperAdapter : this.realAdapter;
    if (!adapter) {
      this.log.warn(
        { clientOrderId, paper: order.paper },
        "Cannot cancel: no adapter for this order (real order needs authenticated session)"
      );
      return false;
    }

    this.registry.transition(clientOrderId, "CANCEL_PENDING");
    await adapter.cancelOrder(order);
    return true;
  }
}
