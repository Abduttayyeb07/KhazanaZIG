import type { VolatilityRegime } from "@zig/shared-types";
import type { RiskConfig, RiskContext, RiskDecision } from "../risk-types.js";

export class SizingEngine {
  private readonly cfg: RiskConfig;

  constructor(cfg: RiskConfig) {
    this.cfg = cfg;
  }

  size(ctx: RiskContext, regime: VolatilityRegime): RiskDecision {
    const requested = ctx.request.quantity;
    const caps: Array<{ reason: string; qty: number }> = [{ reason: "REQUESTED_QTY", qty: requested }];

    if (ctx.request.side === "sell") {
      caps.push({ reason: "MAX_ORDER_ACTIVE_PCT", qty: ctx.treasuryState.activeInventory * this.cfg.maxOrderActivePct });
      caps.push({ reason: "RESERVE_FLOOR_CAP", qty: ctx.treasuryState.activeInventory });
      caps.push({
        reason: "LIQUIDITY_CAP",
        qty: ctx.liquidity.nearbyBidLiquidityZig * this.cfg.liquidityParticipationPct,
      });
      caps.push({
        reason: "DAILY_SELL_LIMIT",
        qty: Math.max(ctx.treasuryState.activeInventory * this.cfg.maxDailySellActivePct - ctx.dailySellUsedZig, 0),
      });
    } else {
      const affordableByUsdt = ctx.request.price > 0 ? ctx.treasuryState.usdtBalance / ctx.request.price : 0;
      caps.push({ reason: "USDT_AFFORDABILITY", qty: affordableByUsdt });
      caps.push({
        reason: "LIQUIDITY_CAP",
        qty: ctx.liquidity.nearbyAskLiquidityZig * this.cfg.liquidityParticipationPct,
      });
      caps.push({
        reason: "DAILY_BUY_LIMIT",
        qty: ctx.request.price > 0
          ? Math.max(ctx.treasuryState.usdtBalance * this.cfg.maxDailyBuyUsdtPct - ctx.dailyBuyUsedUsdt, 0) / ctx.request.price
          : 0,
      });
    }

    caps.push({ reason: "MODE_MULTIPLIER", qty: requested * this.modeMultiplier(ctx.mode) });
    caps.push({ reason: "VOLATILITY_MULTIPLIER", qty: requested * this.volatilityMultiplier(regime) });

    const finiteCaps = caps.map((c) => ({ ...c, qty: Number.isFinite(c.qty) ? Math.max(c.qty, 0) : 0 }));
    const minCap = finiteCaps.reduce((min, cap) => (cap.qty < min.qty ? cap : min), finiteCaps[0]);
    const approved = Math.min(requested, minCap.qty);
    const bindingReasons = finiteCaps.filter((c) => c.qty + 1e-9 < requested).map((c) => c.reason);

    if (approved < this.cfg.minOrderZig) {
      return {
        decision: "REJECT",
        requestedQty: requested,
        approvedQty: 0,
        reasons: [...new Set([...bindingReasons, "BELOW_MIN_ORDER_ZIG"])],
        severity: "WARN",
        metadata: { regime, minOrderZig: this.cfg.minOrderZig, caps: finiteCaps },
      };
    }

    if (approved + 1e-9 < requested) {
      return {
        decision: "REDUCE",
        requestedQty: requested,
        approvedQty: approved,
        reasons: [...new Set(bindingReasons.length ? bindingReasons : [minCap.reason])],
        severity: "WARN",
        metadata: { regime, caps: finiteCaps },
      };
    }

    return {
      decision: "ALLOW",
      requestedQty: requested,
      approvedQty: requested,
      reasons: ["SIZE_APPROVED"],
      severity: "INFO",
      metadata: { regime, caps: finiteCaps },
    };
  }

  private modeMultiplier(mode: RiskContext["mode"]): number {
    if (mode === "DEFENSIVE") return this.cfg.defensiveSizeMultiplier;
    if (mode === "READ_ONLY" || mode === "HALT") return 0;
    return 1;
  }

  private volatilityMultiplier(regime: VolatilityRegime): number {
    if (regime === "HIGH") return this.cfg.highVolSizeMultiplier;
    if (regime === "CHAOTIC") return this.cfg.chaoticSizeMultiplier;
    return 1;
  }
}
