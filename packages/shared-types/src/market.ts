export type Exchange = "bybit" | "mexc";

export type VolatilityRegime = "LOW" | "NORMAL" | "HIGH" | "CHAOTIC";

export type SequenceStatus = "HEALTHY" | "GAP_DETECTED" | "UNINITIALIZED";

export type WebSocketStatus = "CONNECTED" | "CONNECTING" | "RECONNECTING" | "DISCONNECTED";

export interface NormalizedMarketState {
  exchange: Exchange;
  symbol: string;
  timestamp: number;

  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadBps: number;
  midPrice: number;

  bidLiquidity: number;
  askLiquidity: number;
  imbalanceRatio: number;

  volatilityRegime: VolatilityRegime;

  orderbookFreshnessMs: number;
  websocketStatus: WebSocketStatus;
  sequenceStatus: SequenceStatus;
  lastSequence: number;
}

export interface OrderbookLevel {
  price: number;
  size: number;
}

export interface OrderbookSnapshot {
  exchange: Exchange;
  symbol: string;
  timestamp: number;
  sequence: number;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
}
