import type { Exchange, WebSocketStatus, SequenceStatus } from "./market.js";

export type OrderSide = "buy" | "sell";
export type OrderStatus = "open" | "filled" | "partially_filled" | "cancelled" | "rejected";

export interface ExchangeBalance {
  exchange: Exchange;
  asset: string;
  available: number;
  locked: number;
  total: number;
  fetchedAt: number;
}

export interface ExchangeOrder {
  exchange: Exchange;
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  price: number;
  size: number;
  filledSize: number;
  remainingSize: number;
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ExchangeFill {
  exchange: Exchange;
  fillId: string;
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  price: number;
  size: number;
  fee: number;
  feeAsset: string;
  filledAt: number;
}

export interface ExchangeConnectorHealth {
  exchange: Exchange;
  restHealthy: boolean;
  websocketStatus: WebSocketStatus;
  lastRestPingMs: number;
  lastWsMessageMs: number;
  sequenceStatus: SequenceStatus;
  lastSequence: number;
}
