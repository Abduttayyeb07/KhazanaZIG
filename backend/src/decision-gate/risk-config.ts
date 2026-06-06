import type { Config } from "@zig/config";
import type { RiskConfig } from "./risk-types.js";

export function buildRiskConfig(cfg: Config): RiskConfig {
  return {
    maxOrderActivePct: cfg.MAX_ORDER_ACTIVE_PCT,
    maxDailySellActivePct: cfg.MAX_DAILY_SELL_ACTIVE_PCT,
    maxDailyBuyUsdtPct: cfg.MAX_DAILY_BUY_USDT_PCT,
    liquidityParticipationPct: cfg.LIQUIDITY_PARTICIPATION_PCT,
    defensiveSizeMultiplier: cfg.DEFENSIVE_SIZE_MULTIPLIER,
    highVolSizeMultiplier: cfg.HIGH_VOL_SIZE_MULTIPLIER,
    chaoticSizeMultiplier: cfg.CHAOTIC_SIZE_MULTIPLIER,
    minOrderZig: cfg.MIN_ORDER_ZIG,
    maxOpenOrdersPerExchange: cfg.MAX_OPEN_ORDERS_PER_EXCHANGE,
    minSellProfitBps: cfg.MIN_SELL_PROFIT_BPS,
    minRebuyDistanceBps: cfg.MIN_REBUY_DISTANCE_BPS,
    maxSpreadBps: cfg.MAX_SPREAD_BPS,
    chaoticSpreadMultiplier: cfg.CHAOTIC_SPREAD_MULTIPLIER,
    max15mMovePct: cfg.MAX_15M_MOVE_PCT,
    lowVolAtrPct: cfg.LOW_VOL_ATR_PCT,
    normalVolAtrPct: cfg.NORMAL_VOL_ATR_PCT,
    highVolAtrPct: cfg.HIGH_VOL_ATR_PCT,
    maxReconnectsPer5m: cfg.MAX_RECONNECTS_PER_5M,
    reconciliationRequiredStatus: cfg.RECONCILIATION_REQUIRED_STATUS,
    baseAsset: cfg.BASE_ASSET,
    quoteAsset: cfg.QUOTE_ASSET,
    reserveFloor: cfg.RESERVE_FLOOR,
  };
}
