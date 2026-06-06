import type { PrismaClient } from "@prisma/client";
import type { Logger } from "@zig/logger";
import type { ManagedOrder, ManagedOrderStatus, Exchange, ExecutionSource } from "@zig/shared-types";

const TERMINAL: ManagedOrderStatus[] = ["FILLED", "CANCELLED", "REJECTED", "FAILED"];

// ── OrderStore ─────────────────────────────────────────────────────────────────
//
// Durable persistence for REAL managed orders. Paper orders are simulation
// artifacts and are NEVER written here (skipped at save). On restart, active
// (non-terminal) orders are loaded back so idempotency and crash-recovery survive.
// ──────────────────────────────────────────────────────────────────────────────

export class OrderStore {
  private readonly prisma: PrismaClient | null;
  private readonly log: Logger;

  constructor(prisma: PrismaClient | null, log: Logger) {
    this.prisma = prisma;
    this.log = log.child({ module: "order-store" });
  }

  // Upsert an order's current state. No-op for paper orders.
  async save(order: ManagedOrder): Promise<void> {
    if (!this.prisma || order.paper) return;
    const data = {
      requestId: order.requestId,
      exchange: order.exchange,
      symbol: order.symbol,
      side: order.side,
      price: order.price,
      quantity: order.quantity,
      filledQuantity: order.filledQuantity,
      status: order.status,
      source: order.source,
      reason: order.reason,
      exchangeOrderId: order.exchangeOrderId,
      createdAt: new Date(order.createdAt),
      updatedAt: new Date(order.updatedAt),
    };
    try {
      await this.prisma.managedOrder.upsert({
        where: { clientOrderId: order.clientOrderId },
        create: { clientOrderId: order.clientOrderId, ...data },
        update: data,
      });
    } catch (err) {
      this.log.warn({ err, clientOrderId: order.clientOrderId }, "Failed to persist managed order");
    }
  }

  // Load non-terminal orders — the live set that needs recovery on boot.
  async loadActive(): Promise<ManagedOrder[]> {
    if (!this.prisma) return [];
    const rows = await this.prisma.managedOrder.findMany({
      where: { status: { notIn: TERMINAL } },
    });
    return rows.map((r) => ({
      clientOrderId: r.clientOrderId,
      requestId: r.requestId,
      exchange: r.exchange as Exchange,
      symbol: r.symbol,
      side: r.side as "buy" | "sell",
      price: Number(r.price),
      quantity: Number(r.quantity),
      filledQuantity: Number(r.filledQuantity),
      status: r.status as ManagedOrderStatus,
      source: r.source as ExecutionSource,
      reason: r.reason,
      exchangeOrderId: r.exchangeOrderId,
      paper: false, // only real orders are ever stored
      createdAt: r.createdAt.getTime(),
      updatedAt: r.updatedAt.getTime(),
    }));
  }
}
