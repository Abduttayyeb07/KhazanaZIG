import axios, { type AxiosInstance } from "axios";
import crypto from "crypto";
import type { Logger } from "@zig/logger";
import type { ExchangeBalance, ExchangeOrder, ExchangeFill } from "@zig/shared-types";
import { sanitizeHttpError } from "../http-error.js";

const BASE_URL = "https://api.bybit.com";
const RECV_WINDOW = 5000;

interface BybitResponse<T> {
  retCode: number;
  retMsg: string;
  result: T;
  time: number;
}

export class BybitRestClient {
  private readonly http: AxiosInstance;
  private readonly log: Logger;
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(apiKey: string, apiSecret: string, log: Logger) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.log = log.child({ client: "bybit-rest" });

    this.http = axios.create({
      baseURL: BASE_URL,
      timeout: 10_000,
      headers: { "Content-Type": "application/json" },
    });
  }

  async getBalances(): Promise<ExchangeBalance[]> {
    const now = Date.now();
    // Aggregate by asset across wallets. A coin (e.g. USDT) can sit in both the
    // Unified trading account AND the Funding wallet — we sum to show true holdings.
    // NOTE: location matters for execution (you can only trade what's in the
    // trading account); that distinction is handled later by the treasury layer.
    const byAsset = new Map<string, ExchangeBalance>();
    const add = (asset: string, total: number, available: number, locked: number) => {
      if (total <= 0 && available <= 0 && locked <= 0) return; // skip empty coins
      const existing = byAsset.get(asset);
      if (existing) {
        existing.total += total;
        existing.available += available;
        existing.locked += locked;
      } else {
        byAsset.set(asset, { exchange: "bybit", asset, available, locked, total, fetchedAt: now });
      }
    };

    // 1. UNIFIED trading account
    try {
      const unified = await this.signedGet<{
        list: Array<{
          accountType: string;
          coin: Array<{
            coin: string;
            availableToWithdraw?: string;
            locked?: string;
            walletBalance: string;
          }>;
        }>;
      }>("/v5/account/wallet-balance", { accountType: "UNIFIED" });

      for (const account of unified.list) {
        for (const coin of account.coin) {
          const total = parseNumber(coin.walletBalance);
          const locked = parseNumber(coin.locked);
          const atw = parseNumber(coin.availableToWithdraw);
          const available = atw > 0 ? atw : Math.max(total - locked, 0);
          add(coin.coin, total, available, locked);
        }
      }
    } catch (err) {
      this.log.warn({ err }, "Bybit UNIFIED balance fetch failed");
    }

    // 2. FUND (funding) wallet — freshly bought spot tokens commonly live here
    try {
      const fund = await this.signedGet<{
        balance: Array<{ coin: string; walletBalance: string; transferBalance: string }>;
      }>("/v5/asset/transfer/query-account-coins-balance", { accountType: "FUND" });

      for (const c of fund.balance ?? []) {
        const total = parseNumber(c.walletBalance);
        const available = parseNumber(c.transferBalance);
        const locked = Math.max(total - available, 0);
        add(c.coin, total, available, locked);
      }
    } catch (err) {
      this.log.warn({ err }, "Bybit FUND balance fetch failed (key may lack asset/transfer permission)");
    }

    const balances = [...byAsset.values()];
    this.log.info(
      { count: balances.length, assets: balances.map((b) => `${b.asset}:${b.total}`) },
      "Bybit balances fetched"
    );
    return balances;
  }

  async getOpenOrders(symbol: string): Promise<ExchangeOrder[]> {
    const data = await this.signedGet<{
      list: Array<{
        orderId: string;
        orderLinkId: string;
        symbol: string;
        side: string;
        price: string;
        qty: string;
        cumExecQty: string;
        leavesQty: string;
        orderStatus: string;
        createdTime: string;
        updatedTime: string;
      }>;
    }>("/v5/order/realtime", { category: "spot", symbol });

    return data.list.map((o) => ({
      exchange: "bybit" as const,
      orderId: o.orderId,
      clientOrderId: o.orderLinkId,
      symbol: o.symbol,
      side: o.side.toLowerCase() as "buy" | "sell",
      price: parseFloat(o.price),
      size: parseFloat(o.qty),
      filledSize: parseFloat(o.cumExecQty),
      remainingSize: parseFloat(o.leavesQty),
      status: this.mapOrderStatus(o.orderStatus),
      createdAt: parseInt(o.createdTime),
      updatedAt: parseInt(o.updatedTime),
    }));
  }

  async getRecentFills(symbol: string, limit = 50): Promise<ExchangeFill[]> {
    const data = await this.signedGet<{
      list: Array<{
        execId: string;
        orderId: string;
        orderLinkId: string;
        symbol: string;
        side: string;
        execPrice: string;
        execQty: string;
        execFee: string;
        feeCurrency: string;
        execTime: string;
      }>;
    }>("/v5/execution/list", { category: "spot", symbol, limit: String(limit) });

    return data.list.map((f) => ({
      exchange: "bybit" as const,
      fillId: f.execId,
      orderId: f.orderId,
      clientOrderId: f.orderLinkId,
      symbol: f.symbol,
      side: f.side.toLowerCase() as "buy" | "sell",
      price: parseFloat(f.execPrice),
      size: parseFloat(f.execQty),
      fee: parseFloat(f.execFee),
      feeAsset: f.feeCurrency,
      filledAt: parseInt(f.execTime),
    }));
  }

  async ping(): Promise<number> {
    const start = Date.now();
    await this.http.get("/v5/market/time");
    return Date.now() - start;
  }

  // Place a spot LIMIT order. Returns the exchange orderId. clientOrderId is sent
  // as orderLinkId so we can match fills/cancels back to our managed order.
  async placeLimitOrder(p: {
    symbol: string;
    side: "buy" | "sell";
    price: number;
    qty: number;
    clientOrderId: string;
  }): Promise<{ orderId: string }> {
    const result = await this.signedPost<{ orderId: string; orderLinkId: string }>("/v5/order/create", {
      category: "spot",
      symbol: p.symbol,
      side: p.side === "buy" ? "Buy" : "Sell",
      orderType: "Limit",
      qty: String(p.qty),
      price: String(p.price),
      timeInForce: "GTC",
      orderLinkId: p.clientOrderId,
    });
    return { orderId: result.orderId };
  }

  async cancelOrder(p: { symbol: string; clientOrderId: string }): Promise<void> {
    await this.signedPost("/v5/order/cancel", {
      category: "spot",
      symbol: p.symbol,
      orderLinkId: p.clientOrderId,
    });
  }

  // V5 POST signing: HMAC(timestamp + apiKey + recvWindow + rawJsonBody).
  // The signed body MUST be the exact string sent, so we serialize once.
  private async signedPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const timestamp = Date.now().toString();
    const raw = JSON.stringify(body);
    const toSign = `${timestamp}${this.apiKey}${RECV_WINDOW}${raw}`;
    const signature = crypto.createHmac("sha256", this.apiSecret).update(toSign).digest("hex");

    let response;
    try {
      response = await this.http.post<BybitResponse<T>>(path, raw, {
        headers: {
          "X-BAPI-API-KEY": this.apiKey,
          "X-BAPI-TIMESTAMP": timestamp,
          "X-BAPI-RECV-WINDOW": String(RECV_WINDOW),
          "X-BAPI-SIGN": signature,
          "Content-Type": "application/json",
        },
      });
    } catch (err) {
      throw sanitizeHttpError("Bybit", err);
    }

    if (response.data.retCode !== 0) {
      throw new Error(`Bybit REST error ${response.data.retCode}: ${response.data.retMsg}`);
    }
    return response.data.result;
  }

  private async signedGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const timestamp = Date.now().toString();
    const queryString = new URLSearchParams(params).toString();
    const toSign = `${timestamp}${this.apiKey}${RECV_WINDOW}${queryString}`;
    const signature = crypto.createHmac("sha256", this.apiSecret).update(toSign).digest("hex");

    let response;
    try {
      response = await this.http.get<BybitResponse<T>>(path, {
        params,
        headers: {
          "X-BAPI-API-KEY": this.apiKey,
          "X-BAPI-TIMESTAMP": timestamp,
          "X-BAPI-RECV-WINDOW": String(RECV_WINDOW),
          "X-BAPI-SIGN": signature,
        },
      });
    } catch (err) {
      // Never let the raw axios error escape — it carries headers with the API key
      throw sanitizeHttpError("Bybit", err);
    }

    if (response.data.retCode !== 0) {
      throw new Error(`Bybit REST error ${response.data.retCode}: ${response.data.retMsg}`);
    }

    return response.data.result;
  }

  private mapOrderStatus(status: string): ExchangeOrder["status"] {
    switch (status) {
      case "New":
      case "PartiallyFilled":
        return status === "PartiallyFilled" ? "partially_filled" : "open";
      case "Filled":
        return "filled";
      case "Cancelled":
      case "PartiallyFilledCanceled":
        return "cancelled";
      case "Rejected":
        return "rejected";
      default:
        return "open";
    }
  }
}

function parseNumber(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
