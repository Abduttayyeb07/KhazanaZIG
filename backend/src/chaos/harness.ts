import { createLogger } from "@zig/logger";
import type { ExecutionRequest, ExchangeOrder, ExchangeFill, OrderEvent } from "@zig/shared-types";
import { OrderRegistry } from "../execution-engine/registry.js";
import { OrderReconciler } from "../execution-engine/order-reconciler.js";
import { TreasuryEngine } from "../treasury/engine.js";
import type { AuthenticatedExchangeClient } from "../session/session-manager.js";

// ── Phase 4 Week 4 — Execution chaos harness ───────────────────────────────────
//
// Deterministically reproduces the failure modes that destroy trading systems and
// asserts the machinery survives. No network, no DB — pure logic, repeatable.
//
//   A  duplicate fills              → must dedup (no double-count)
//   B  partial fill during reconnect→ recover to exact filled qty
//   C  cancel race                  → fill wins if it lands first
//   D  restart recovery             → rebuild live order from exchange truth
//   E  delayed websocket            → never falsely cancel an in-flight order
// ──────────────────────────────────────────────────────────────────────────────

const log = createLogger("chaos", "error");
let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} ${detail}`); }
}

function req(clientReqId: string, side: "buy" | "sell", qty: number, price: number): ExecutionRequest {
  return { requestId: clientReqId, exchange: "bybit", symbol: "ZIGUSDT", type: "LIMIT", tif: "GTC", side, quantity: qty, price, source: "OPERATOR", reason: "chaos", createdAt: Date.now() };
}
function exOrder(clientOrderId: string, filledSize: number): ExchangeOrder {
  return { exchange: "bybit", orderId: "EX-" + clientOrderId, clientOrderId, symbol: "ZIGUSDT", side: "buy", price: 0.05, size: 100, filledSize, remainingSize: 100 - filledSize, status: "open", createdAt: Date.now(), updatedAt: Date.now() };
}
function exFill(clientOrderId: string, size: number, fillId: string): ExchangeFill {
  return { exchange: "bybit", fillId, orderId: "EX-" + clientOrderId, clientOrderId, symbol: "ZIGUSDT", side: "buy", price: 0.05, size, fee: 0, feeAsset: "USDT", filledAt: Date.now() };
}
function mockClient(open: ExchangeOrder[], fills: ExchangeFill[]): AuthenticatedExchangeClient {
  const rest = { getOpenOrders: async () => open, getRecentFills: async () => fills };
  return { bybit: rest as never, mexc: null, has: () => true } as AuthenticatedExchangeClient;
}
function fillEvent(clientOrderId: string, qty: number, fillId: string, full: boolean): OrderEvent {
  return { type: full ? "ORDER_FILLED" : "ORDER_PARTIALLY_FILLED", clientOrderId, exchange: "bybit", exchangeOrderId: "EX", fillId, fillPrice: 0.05, fillQuantity: qty, fee: 0, feeAsset: "USDT", at: Date.now() };
}

async function scenarioA() {
  console.log("\nA. Duplicate fills → must dedup");
  const reg = new OrderRegistry(log);
  const treasury = new TreasuryEngine(null, { baseAsset: "ZIG", quoteAsset: "USDT", reserveFloor: 0 }, log);
  await treasury.init();
  let fillEmits = 0;
  reg.on("fill", (ev: OrderEvent, order) => {
    fillEmits++;
    void treasury.ingest([exFill(order.clientOrderId, ev.fillQuantity ?? 0, ev.fillId ?? "x")]);
  });
  const id = "zig-A";
  reg.register(req("A", "buy", 100, 0.05), id, false);
  reg.transition(id, "SUBMITTED");
  reg.applyEvent({ type: "ORDER_OPENED", clientOrderId: id, exchange: "bybit", at: Date.now() });
  reg.applyEvent(fillEvent(id, 100, "FILL-A-1", true));
  reg.applyEvent(fillEvent(id, 100, "FILL-A-1", true)); // exact duplicate

  const o = reg.get(id)!;
  check("filledQuantity counted once (100)", o.filledQuantity === 100, `got ${o.filledQuantity}`);
  check("status FILLED", o.status === "FILLED", o.status);
  check("fill emitted to treasury once", fillEmits === 1, `got ${fillEmits}`);
  await new Promise((r) => setTimeout(r, 10));
  check("treasury counts fill once", treasury.derive(null).fillCount === 1, `got ${treasury.derive(null).fillCount}`);
}

async function scenarioB() {
  console.log("\nB. Partial fill during reconnect → exact recovery, no double-count");
  const reg = new OrderRegistry(log);
  const id = "zig-B";
  reg.register(req("B", "buy", 100, 0.05), id, false);
  reg.transition(id, "SUBMITTED");
  reg.transition(id, "OPEN");
  const recon = new OrderReconciler(reg, "ZIGUSDT", log);
  const realFills: ExchangeFill[] = [];
  // Exchange truth after reconnect: still open, 30 filled
  const client = mockClient([exOrder(id, 30)], [exFill(id, 30, "FILL-B-1")]);
  await recon.reconcile(client, (f) => realFills.push(f));
  let o = reg.get(id)!;
  check("PARTIALLY_FILLED after reconnect", o.status === "PARTIALLY_FILLED", o.status);
  check("filled = 30", o.filledQuantity === 30, `got ${o.filledQuantity}`);
  // Run reconcile AGAIN (duplicate cycle) — authoritative set must not double
  await recon.reconcile(client, (f) => realFills.push(f));
  o = reg.get(id)!;
  check("filled still 30 after re-reconcile", o.filledQuantity === 30, `got ${o.filledQuantity}`);
}

async function scenarioC() {
  console.log("\nC. Cancel race → fill wins if it lands first");
  const reg = new OrderRegistry(log);
  const id = "zig-C";
  reg.register(req("C", "buy", 100, 0.05), id, false);
  reg.transition(id, "SUBMITTED");
  reg.transition(id, "OPEN");
  reg.transition(id, "CANCEL_PENDING");              // operator requested cancel
  reg.applyEvent(fillEvent(id, 100, "FILL-C-1", true)); // but it fills first
  const o = reg.get(id)!;
  check("status FILLED (fill won the race)", o.status === "FILLED", o.status);
  check("not CANCELLED", o.status !== "CANCELLED");
}

async function scenarioD() {
  console.log("\nD. Restart recovery → rebuild live order from exchange truth");
  const reg = new OrderRegistry(log);
  // Simulate a hydrated order that was live before the crash (SUBMITTED, real)
  reg.hydrate([{ clientOrderId: "zig-D", requestId: "D", exchange: "bybit", symbol: "ZIGUSDT", side: "buy", price: 0.05, quantity: 100, filledQuantity: 0, status: "SUBMITTED", source: "OPERATOR", reason: "crash", exchangeOrderId: null, paper: false, createdAt: Date.now(), updatedAt: Date.now() }]);
  const recon = new OrderReconciler(reg, "ZIGUSDT", log);
  const realFills: ExchangeFill[] = [];
  // Exchange truth: order gone from book, fully filled while we were down
  const client = mockClient([], [exFill("zig-D", 100, "FILL-D-1")]);
  await recon.reconcile(client, (f) => realFills.push(f));
  const o = reg.get("zig-D")!;
  check("recovered to FILLED", o.status === "FILLED", o.status);
  check("filled = 100 from exchange truth", o.filledQuantity === 100, `got ${o.filledQuantity}`);
  check("real fill surfaced to treasury", realFills.length === 1, `got ${realFills.length}`);
}

async function scenarioE() {
  console.log("\nE. Delayed websocket → never falsely cancel an in-flight order");
  const reg = new OrderRegistry(log);
  const id = "zig-E";
  reg.register(req("E", "buy", 100, 0.05), id, false);
  reg.transition(id, "SUBMITTED"); // just placed; exchange hasn't reflected it yet
  const recon = new OrderReconciler(reg, "ZIGUSDT", log);
  // Cycle 1: exchange shows nothing (REST lag) — must NOT cancel
  await recon.reconcile(mockClient([], []), () => {});
  let o = reg.get(id)!;
  check("still SUBMITTED (not falsely cancelled)", o.status === "SUBMITTED", o.status);
  // Cycle 2: exchange now reflects it as open
  await recon.reconcile(mockClient([exOrder(id, 0)], []), () => {});
  o = reg.get(id)!;
  check("resolves to OPEN once visible", o.status === "OPEN", o.status);
}

async function run() {
  console.log("══════════ EXECUTION CHAOS HARNESS ══════════");
  await scenarioA();
  await scenarioB();
  await scenarioC();
  await scenarioD();
  await scenarioE();
  console.log(`\n══════════ ${passed} passed, ${failed} failed ══════════`);
  process.exit(failed === 0 ? 0 : 1);
}
run();
