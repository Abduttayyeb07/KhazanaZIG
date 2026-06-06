import axios, { type AxiosInstance } from "axios";
import crypto from "crypto";
import type { Logger } from "@zig/logger";
import type { ExchangeBalance, ExchangeOrder, ExchangeFill } from "@zig/shared-types";
import { sanitizeHttpError } from "../http-error.js";

const BASE_URL = "https://api.mexc.com";

export class MexcRestClient {
  private readonly http: AxiosInstance;
  private readonly log: Logger;
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(apiKey: string, apiSecret: string, log: Logger) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.log = log.child({ client: "mexc-rest" });

    this.http = axios.create({
      baseURL: BASE_URL,
      timeout: 10_000,
      headers: {
        "Content-Type": "application/json",
        "X-MEXC-APIKEY": this.apiKey,
      },
    });
  }

  async getBalances(): Promise<ExchangeBalance[]> {
    // /api/v3/account returns the SPOT wallet — the correct place for spot tokens.
    // (Unlike Bybit there is no Unified/Funding split for the spot API.) Funds held
    // in the MEXC Futures wallet are NOT returned here — they'd need a transfer to Spot.
    const data = await this.signedGet<{
      balances: Array<{ asset: string; free: string; locked: string }>;
    }>("/api/v3/account");

    const now = Date.now();
    const balances = data.balances
      .filter((b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
      .map((b) => {
        const available = parseFloat(b.free);
        const locked = parseFloat(b.locked);
        return {
          exchange: "mexc" as const,
          asset: b.asset,
          available,
          locked,
          total: available + locked,
          fetchedAt: now,
        };
      });

    this.log.info(
      { count: balances.length, assets: balances.map((b) => `${b.asset}:${b.total}`) },
      "MEXC balances fetched"
    );
    return balances;
  }

  async getOpenOrders(symbol: string): Promise<ExchangeOrder[]> {
    const data = await this.signedGet<
      Array<{
        orderId: string;
        clientOrderId: string;
        symbol: string;
        side: string;
        price: string;
        origQty: string;
        executedQty: string;
        status: string;
        time: number;
        updateTime: number;
      }>
    >("/api/v3/openOrders", { symbol });

    return data.map((o) => {
      const size = parseFloat(o.origQty);
      const filled = parseFloat(o.executedQty);
      return {
        exchange: "mexc" as const,
        orderId: o.orderId,
        clientOrderId: o.clientOrderId,
        symbol: o.symbol,
        side: o.side.toLowerCase() as "buy" | "sell",
        price: parseFloat(o.price),
        size,
        filledSize: filled,
        remainingSize: size - filled,
        status: this.mapOrderStatus(o.status),
        createdAt: o.time,
        updatedAt: o.updateTime,
      };
    });
  }

  async getRecentFills(symbol: string, limit = 50): Promise<ExchangeFill[]> {
    const data = await this.signedGet<
      Array<{
        id: string;
        orderId: string;
        clientOrderId?: string;
        symbol: string;
        isBuyer: boolean;
        price: string;
        qty: string;
        commission: string;
        commissionAsset: string;
        time: number;
      }>
    >("/api/v3/myTrades", { symbol, limit: String(limit) });

    return data.map((f) => ({
      exchange: "mexc" as const,
      fillId: f.id,
      orderId: f.orderId,
      clientOrderId: f.clientOrderId ?? "",
      symbol: f.symbol,
      side: f.isBuyer ? ("buy" as const) : ("sell" as const),
      price: parseFloat(f.price),
      size: parseFloat(f.qty),
      fee: parseFloat(f.commission),
      feeAsset: f.commissionAsset,
      filledAt: f.time,
    }));
  }

  async ping(): Promise<number> {
    const start = Date.now();
    await this.http.get("/api/v3/ping");
    return Date.now() - start;
  }

  // Place a spot LIMIT order. newClientOrderId carries our clientOrderId so fills
  // and cancels can be matched back to the managed order.
  async placeLimitOrder(p: {
    symbol: string;
    side: "buy" | "sell";
    price: number;
    qty: number;
    clientOrderId: string;
  }): Promise<{ orderId: string }> {
    const res = await this.signedRequest<{ orderId: string }>("post", "/api/v3/order", {
      symbol: p.symbol,
      side: p.side === "buy" ? "BUY" : "SELL",
      type: "LIMIT",
      quantity: String(p.qty),
      price: String(p.price),
      newClientOrderId: p.clientOrderId,
    });
    return { orderId: String(res.orderId) };
  }

  async cancelOrder(p: { symbol: string; clientOrderId: string }): Promise<void> {
    await this.signedRequest("delete", "/api/v3/order", {
      symbol: p.symbol,
      origClientOrderId: p.clientOrderId,
    });
  }

  // Signed POST/DELETE — MEXC signs the query string (same scheme as GET) and
  // sends params in the query, even for POST/DELETE.
  private async signedRequest<T>(
    method: "post" | "delete",
    path: string,
    params: Record<string, string> = {}
  ): Promise<T> {
    const timestamp = Date.now().toString();
    const queryParams = { ...params, timestamp };
    const queryString = new URLSearchParams(queryParams).toString();
    const signature = crypto.createHmac("sha256", this.apiSecret).update(queryString).digest("hex");
    try {
      const response = await this.http.request<T>({
        method,
        url: path,
        params: { ...queryParams, signature },
      });
      return response.data;
    } catch (err) {
      throw sanitizeHttpError("MEXC", err);
    }
  }

  private async signedGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const timestamp = Date.now().toString();
    const queryParams = { ...params, timestamp };
    const queryString = new URLSearchParams(queryParams).toString();
    const signature = crypto.createHmac("sha256", this.apiSecret).update(queryString).digest("hex");

    try {
      const response = await this.http.get<T>(path, {
        params: { ...queryParams, signature },
      });
      return response.data;
    } catch (err) {
      // Never let the raw axios error escape — it carries the X-MEXC-APIKEY header
      throw sanitizeHttpError("MEXC", err);
    }
  }

  private mapOrderStatus(status: string): ExchangeOrder["status"] {
    switch (status) {
      case "NEW":
        return "open";
      case "PARTIALLY_FILLED":
        return "partially_filled";
      case "FILLED":
        return "filled";
      case "CANCELED":
      case "CANCELLED":
        return "cancelled";
      case "REJECTED":
        return "rejected";
      default:
        return "open";
    }
  }
}
