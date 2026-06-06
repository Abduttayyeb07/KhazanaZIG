import type { Exchange, ExchangeFill, ExecutionRequest } from "@zig/shared-types";
import type { SystemState } from "../state-engine/store.js";
import type { ManagedOrder } from "@zig/shared-types";
import type { RiskConfig, RiskContext } from "./risk-types.js";

const STALE_MARKET_MS = 5_000;

export function buildRiskContext(
  request: ExecutionRequest,
  state: SystemState,
  openOrders: ManagedOrder[],
  cfg: RiskConfig
): RiskContext {
  const market = state.market[request.exchange];
  const balances = state.balances[request.exchange];
  const base = balances.find((b) => b.asset === cfg.baseAsset);
  const quote = balances.find((b) => b.asset === cfg.quoteAsset);
  const totalBase = base?.total ?? 0;
  const reserveInventory = Math.min(totalBase, cfg.reserveFloor);
  const activeInventory = Math.max(totalBase - reserveInventory - committedOpenSellQty(openOrders, request.exchange), 0);
  const fills = [...state.fills.bybit, ...state.fills.mexc];

  return {
    request,
    mode: state.mode,
    marketState: market,
    treasuryState: {
      totalZig: totalBase,
      activeInventory,
      reserveInventory,
      reserveFloor: cfg.reserveFloor,
      usdtBalance: quote?.available ?? quote?.total ?? 0,
      averageCost: averageCost(fills, cfg.baseAsset, cfg.quoteAsset),
    },
    reconciliationStatus: state.lastReconciliation[request.exchange]?.status ?? null,
    exchangeHealth: {
      websocketHealthy: market?.websocketStatus === "CONNECTED",
      sequenceHealthy: market?.sequenceStatus === "HEALTHY",
      reconnectsLast5m: 0,
      stale: market ? market.orderbookFreshnessMs > STALE_MARKET_MS : true,
    },
    openOrdersCount: openOrders.filter((o) => o.exchange === request.exchange && !isTerminal(o.status)).length,
    dailySellUsedZig: dailySellUsed(fills),
    dailyBuyUsedUsdt: dailyBuyUsed(fills),
    liquidity: {
      nearbyBidLiquidityZig: market?.bidLiquidity ?? 0,
      nearbyAskLiquidityZig: market?.askLiquidity ?? 0,
      nearbyBidLiquidityUsdt: (market?.bidLiquidity ?? 0) * (market?.bestBid ?? 0),
      nearbyAskLiquidityUsdt: (market?.askLiquidity ?? 0) * (market?.bestAsk ?? 0),
    },
  };
}

function committedOpenSellQty(openOrders: ManagedOrder[], exchange: Exchange): number {
  return openOrders
    .filter((o) => o.exchange === exchange && o.side === "sell" && !isTerminal(o.status))
    .reduce((sum, o) => sum + Math.max(o.quantity - o.filledQuantity, 0), 0);
}

function isTerminal(status: ManagedOrder["status"]): boolean {
  return status === "FILLED" || status === "CANCELLED" || status === "REJECTED" || status === "FAILED";
}

function dailySellUsed(fills: ExchangeFill[]): number {
  const start = startOfUtcDay();
  return fills
    .filter((f) => f.side === "sell" && f.filledAt >= start)
    .reduce((sum, f) => sum + f.size, 0);
}

function dailyBuyUsed(fills: ExchangeFill[]): number {
  const start = startOfUtcDay();
  return fills
    .filter((f) => f.side === "buy" && f.filledAt >= start)
    .reduce((sum, f) => sum + f.size * f.price, 0);
}

function startOfUtcDay(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function averageCost(fills: ExchangeFill[], baseAsset: string, quoteAsset: string): number | undefined {
  void baseAsset;
  void quoteAsset;
  let qty = 0;
  let cost = 0;
  for (const f of fills.sort((a, b) => a.filledAt - b.filledAt)) {
    if (f.side === "buy") {
      qty += f.size;
      cost += f.size * f.price;
    } else {
      const sellQty = Math.min(qty, f.size);
      if (qty > 0) {
        const avg = cost / qty;
        qty -= sellQty;
        cost -= avg * sellQty;
      }
    }
  }
  return qty > 0 ? cost / qty : undefined;
}
