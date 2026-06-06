import type { PrismaClient } from "@prisma/client";
import type { Logger } from "@zig/logger";
import type { ExchangeFill, Exchange } from "@zig/shared-types";

// ── Fill ledger ────────────────────────────────────────────────────────────────
//
// The durable, append-only record of fills — the financial source of truth.
// Fills are NEVER updated or deleted, only inserted. Dedup is enforced by the
// unique `fillId` (insert is a no-op if it already exists). Treasury state is
// always reconstructable by reading this ledger back and running deriveTreasury().
// ──────────────────────────────────────────────────────────────────────────────

export class FillLedger {
  private readonly prisma: PrismaClient | null;
  private readonly log: Logger;

  constructor(prisma: PrismaClient | null, log: Logger) {
    this.prisma = prisma;
    this.log = log.child({ module: "fill-ledger" });
  }

  // Append a fill if not already present. Returns true if newly inserted.
  async append(fill: ExchangeFill): Promise<boolean> {
    if (!this.prisma) return false;
    // Paper/simulated fills must NEVER touch the durable treasury ledger — they
    // are test artifacts, not real treasury memory. They live in-memory only.
    if (fill.fillId.startsWith("PAPER-")) return false;
    try {
      await this.prisma.fill.create({
        data: {
          exchange: fill.exchange,
          fillId: fill.fillId,
          orderId: fill.orderId,
          clientOrderId: fill.clientOrderId,
          symbol: fill.symbol,
          side: fill.side,
          price: fill.price,
          size: fill.size,
          fee: fill.fee,
          feeAsset: fill.feeAsset,
          filledAt: new Date(fill.filledAt),
        },
      });
      return true;
    } catch (err) {
      // Unique-constraint violation = already recorded (expected, idempotent)
      if (isUniqueViolation(err)) return false;
      this.log.warn({ err, fillId: fill.fillId }, "Failed to append fill");
      return false;
    }
  }

  // Bulk append — returns count newly inserted.
  async appendMany(fills: ExchangeFill[]): Promise<number> {
    let inserted = 0;
    for (const f of fills) {
      if (await this.append(f)) inserted++;
    }
    return inserted;
  }

  // Load the full fill history (optionally for one exchange), chronological.
  async load(exchange?: Exchange): Promise<ExchangeFill[]> {
    if (!this.prisma) return [];
    const rows = await this.prisma.fill.findMany({
      where: exchange ? { exchange } : undefined,
      orderBy: { filledAt: "asc" },
    });
    return rows.map((r) => ({
      exchange: r.exchange as Exchange,
      fillId: r.fillId,
      orderId: r.orderId,
      clientOrderId: r.clientOrderId,
      symbol: r.symbol,
      side: r.side as "buy" | "sell",
      price: Number(r.price),
      size: Number(r.size),
      fee: Number(r.fee),
      feeAsset: r.feeAsset,
      filledAt: r.filledAt.getTime(),
    }));
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002";
}
