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
  const paper = state.mode === "PAPER_MODE" ? state.paperRisk?.[request.exchange] : undefined;
  const totalBase = paper?.zig ?? base?.total ?? 0;
  const reserveFloor = Math.max(cfg.reserveFloor, paper?.protectedZig ?? 0);
  const reserveInventory = Math.min(totalBase, reserveFloor);
  const activeInventory = Math.max(totalBase - reserveInventory - committedOpenSellQty(openOrders, request.exchange), 0);
  const fills = state.fills[request.exchange].filter(f => f.symbol === request.symbol);
  const sameDay = paper?.day === new Date(Date.now()).toISOString().slice(0, 10);
  const openBuys = openOrders.filter(o => o.exchange === request.exchange && o.side === "buy" && !isTerminal(o.status));
  const committedUsdt = openBuys.reduce((s,o) => s + Math.max(o.quantity-o.filledQuantity,0)*o.price,0);
  const committedSells = committedOpenSellQty(openOrders, request.exchange);

  return {
    request,
    mode: state.mode,
    marketState: market,
    treasuryState: {
      totalZig: totalBase,
      activeInventory,
      reserveInventory,
      reserveFloor,
      usdtBalance: Math.max((paper?.usdt ?? quote?.available ?? quote?.total ?? 0) - committedUsdt * (1 + (cfg.paperFeeBps ?? 0)/10000), 0),
      dailySellBaseZig: paper?.startingActive,
      dailyBuyBaseUsdt: paper?.startingUsdt,
      averageCost: paper?.averageCost ?? averageCost(fills, cfg.baseAsset, cfg.quoteAsset),
    },
    reconciliationStatus: state.lastReconciliation[request.exchange]?.status ?? null,
    exchangeHealth: {
      websocketHealthy: market?.websocketStatus === "CONNECTED",
      sequenceHealthy: market?.sequenceStatus === "HEALTHY",
      reconnectsLast5m: (market?.reconnectTimestamps ?? []).filter(t => t >= Date.now() - 300_000).length,
      stale: market ? !Number.isFinite(market.timestamp) || market.orderbookFreshnessMs + Math.max(0, Date.now() - market.timestamp) > STALE_MARKET_MS : true,
    },
    openOrdersCount: openOrders.filter((o) => o.exchange === request.exchange && !isTerminal(o.status)).length,
    dailySellUsedZig: (paper ? sameDay ? paper.dailySellZig : 0 : dailySellUsed(fills)) + committedSells,
    dailyBuyUsedUsdt: (paper ? sameDay ? paper.dailyBuyUsdt : 0 : dailyBuyUsed(fills)) + committedUsdt * (1 + (paper ? cfg.paperFeeBps ?? 0 : 0)/10000),
    liquidity: {
      nearbyBidLiquidityZig: market && market.bestBid && market.bestBid > 0 ? market.bidLiquidity / market.bestBid : 0,
      nearbyAskLiquidityZig: market && market.bestAsk && market.bestAsk > 0 ? market.askLiquidity / market.bestAsk : 0,
      nearbyBidLiquidityUsdt: market?.bidLiquidity ?? 0,
      nearbyAskLiquidityUsdt: market?.askLiquidity ?? 0,
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
    .reduce((sum, f) => sum + f.size * f.price + (f.feeAsset === "USDT" ? f.fee : 0), 0);
}

function startOfUtcDay(): number {
  const now = new Date(Date.now());
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
