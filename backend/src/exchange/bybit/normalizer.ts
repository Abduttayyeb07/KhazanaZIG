import type { NormalizedMarketState, WebSocketStatus, SequenceStatus, VolatilityRegime } from "@zig/shared-types";
import type { OrderbookEngine } from "../../orderbook/engine.js";

const LIQUIDITY_LEVELS = 10;

export function buildBybitNormalizedState(
  symbol: string,
  engine: OrderbookEngine,
  wsStatus: WebSocketStatus,
  sequenceStatus: SequenceStatus,
  lastSequence: number
): NormalizedMarketState | null {
  const bestBid = engine.bestBid();
  const bestAsk = engine.bestAsk();

  if (bestBid === null || bestAsk === null) return null;

  const spread = bestAsk - bestBid;
  const midPrice = (bestBid + bestAsk) / 2;
  const spreadBps = (spread / midPrice) * 10_000;

  const bidLiquidity = engine.bidLiquidity(LIQUIDITY_LEVELS);
  const askLiquidity = engine.askLiquidity(LIQUIDITY_LEVELS);
  const total = bidLiquidity + askLiquidity;
  const imbalanceRatio = total > 0 ? (bidLiquidity - askLiquidity) / total : 0;

  return {
    exchange: "bybit",
    symbol,
    timestamp: Date.now(),
    bestBid,
    bestAsk,
    spread,
    spreadBps,
    midPrice,
    bidLiquidity,
    askLiquidity,
    imbalanceRatio,
    volatilityRegime: classifyVolatility(spreadBps),
    orderbookFreshnessMs: engine.freshnessMs(),
    websocketStatus: wsStatus,
    sequenceStatus,
    lastSequence,
  };
}

function classifyVolatility(spreadBps: number): VolatilityRegime {
  if (spreadBps < 5) return "LOW";
  if (spreadBps < 20) return "NORMAL";
  if (spreadBps < 60) return "HIGH";
  return "CHAOTIC";
}
