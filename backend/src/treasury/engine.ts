import type { PrismaClient } from "@prisma/client";
import type { Logger } from "@zig/logger";
import type { ExchangeFill, DerivedTreasury } from "@zig/shared-types";
import { deriveTreasury } from "./derive.js";
import { FillLedger } from "./fill-ledger.js";

export interface TreasuryEngineOptions {
  baseAsset: string;
  quoteAsset: string;
  reserveFloor: number;
}

// ── Treasury Engine ────────────────────────────────────────────────────────────
//
// Owns the fill ledger and derives live treasury state. Combines fills across
// BOTH exchanges — the treasury holds ZIG regardless of venue, so inventory,
// cost basis, and harvested PnL are computed over the union of all fills.
//
// Flow:  ingest(fills) → dedup + append new ones to durable ledger → re-derive.
// State is always reconstructable: on boot we load the ledger and rebuild.
// ──────────────────────────────────────────────────────────────────────────────

export class TreasuryEngine {
  private readonly ledger: FillLedger;
  private readonly prisma: PrismaClient | null;
  private readonly opts: TreasuryEngineOptions;
  private readonly log: Logger;

  private readonly fills = new Map<string, ExchangeFill>();
  private snapshotTimer: NodeJS.Timeout | null = null;
  private snapshotsDisabled = false;

  constructor(prisma: PrismaClient | null, opts: TreasuryEngineOptions, log: Logger) {
    this.prisma = prisma;
    this.opts = opts;
    this.ledger = new FillLedger(prisma, log);
    this.log = log.child({ module: "treasury-engine" });
  }

  // Load the durable fill ledger into memory (reconstruction baseline).
  async init(): Promise<void> {
    const stored = await this.ledger.load();
    for (const f of stored) this.fills.set(f.fillId, f);
    this.log.info({ fills: this.fills.size, reserveFloor: this.opts.reserveFloor }, "Treasury engine initialized from ledger");
  }

  // Ingest fills from state recovery / reconciliation. New ones are appended to
  // the durable ledger (append-only, dedup by fillId). Returns true if changed.
  async ingest(fills: ExchangeFill[]): Promise<boolean> {
    let changed = false;
    for (const f of fills) {
      if (this.fills.has(f.fillId)) continue;
      this.fills.set(f.fillId, f);
      await this.ledger.append(f); // durable, idempotent
      changed = true;
    }
    return changed;
  }

  // Derive current treasury state from the full ledger + a mark price.
  derive(markPrice: number | null): DerivedTreasury {
    return deriveTreasury([...this.fills.values()], {
      baseAsset: this.opts.baseAsset,
      quoteAsset: this.opts.quoteAsset,
      reserveFloor: this.opts.reserveFloor,
      markPrice,
    });
  }

  // Persist a durable treasury snapshot (history graph / audit baseline).
  async snapshot(markPrice: number | null): Promise<void> {
    if (!this.prisma) return;
    if (this.snapshotsDisabled) return;
    const t = this.derive(markPrice);
    try {
      await this.prisma.treasuryState.create({
        data: {
          baseAsset: t.baseAsset,
          quoteAsset: t.quoteAsset,
          totalBase: t.totalBase,
          activeAmount: t.activeBase,
          reserveAmount: t.reserveBase,
          reserveFloor: t.reserveFloor,
          avgCost: t.avgCost,
          realizedPnlUsdt: t.realizedPnlUsdt,
          unrealizedPnlUsdt: t.unrealizedPnlUsdt ?? 0,
          totalFeesUsdt: t.totalFeesUsdt,
          markPrice: t.markPrice ?? 0,
          inventoryValueUsdt: t.inventoryValueUsdt ?? 0,
          fillCount: t.fillCount,
        },
      });
    } catch (err) {
      if (this.isMissingTable(err)) {
        this.snapshotsDisabled = true;
        this.log.warn("Treasury state table missing - durable snapshots disabled for this process");
        return;
      }
      this.log.warn({ err }, "Failed to persist treasury snapshot");
    }
  }

  startSnapshots(intervalMs: number, getMarkPrice: () => number | null): void {
    if (this.snapshotTimer) return;
    this.snapshotTimer = setInterval(() => {
      void this.snapshot(getMarkPrice());
    }, intervalMs);
  }

  stop(): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  private isMissingTable(err: unknown): boolean {
    return (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "P2021"
    );
  }
}
