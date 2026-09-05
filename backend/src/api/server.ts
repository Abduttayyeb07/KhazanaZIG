import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import type { Logger } from "@zig/logger";
import { verifyOperatorToken } from "./middleware/require-operator.js";
import { RateLimiter } from "./middleware/rate-limit.js";
import { MAX_BODY_BYTES } from "./middleware/sanitize-body.js";
import { AuditLog } from "./audit.js";

export interface RouteContext {
  body: unknown;
  ip: string;
  operator: boolean;
  cookies: Record<string, string>;
  send: (status: number, payload: unknown, headers?: Record<string, string | string[]>) => void;
}

export type RouteHandler = (ctx: RouteContext) => Promise<void> | void;
type Method = "GET" | "POST" | "DELETE";

export interface ApiServerOptions {
  operatorToken: string;
  dashboardOrigin: string;
  audit: AuditLog;
  validateSessionToken?: (token: string | undefined) => Promise<boolean>;
  sessionCookieName?: string;
}

// Any route under this prefix is a CONTROL route — auth enforced centrally.
const OPERATOR_PREFIX = "/api/operator/";

export interface DashboardExchange {
  wsStatus: "CONNECTED" | "RECONNECTING" | "DISCONNECTED";
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  spreadBps: number | null;
  midPrice: number | null;
  imbalanceRatio: number | null;
  regime: string | null;
  freshnessMs: number | null;
}

export interface DashboardBalance {
  exchange: string;
  asset: string;
  available: number;
  locked: number;
  total: number;
  fetchedAt: number;
}

export interface DashboardOrder {
  exchange: string;
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  price: number;
  size: number;
  filledSize: number;
  remainingSize: number;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface DashboardFill {
  exchange: string;
  fillId: string;
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  price: number;
  size: number;
  fee: number;
  feeAsset: string;
  filledAt: number;
}

export interface DashboardReconciliation {
  timestamp: number;
  exchange: string;
  status: string;
  issues: Array<{
    category: string;
    status: string;
    detail: string;
    field?: string;
    expected?: string | number;
    actual?: string | number;
  }>;
  requiresExecutionHalt: boolean;
  repaired: boolean;
}

export interface DashboardAccountState {
  balances: {
    bybit: DashboardBalance[];
    mexc: DashboardBalance[];
  };
  openOrders: {
    bybit: DashboardOrder[];
    mexc: DashboardOrder[];
  };
  fills: {
    bybit: DashboardFill[];
    mexc: DashboardFill[];
  };
  reconciliation: {
    bybit: DashboardReconciliation | null;
    mexc: DashboardReconciliation | null;
  };
}

export interface DashboardEvent {
  time: string;
  level: "info" | "warn" | "error";
  msg: string;
}

export interface DashboardTreasury {
  baseAsset: string;
  quoteAsset: string;
  reserveFloor: number;
  totalBase: number;
  activeBase: number;
  reserveBase: number;
  avgCost: number;
  realizedPnlUsdt: number;
  totalFeesUsdt: number;
  markPrice: number | null;
  unrealizedPnlUsdt: number | null;
  inventoryValueUsdt: number | null;
  fillCount: number;
  lastFillAt: number | null;
}

export interface DashboardManagedOrder {
  clientOrderId: string;
  exchange: string;
  side: "buy" | "sell";
  price: number;
  quantity: number;
  filledQuantity: number;
  status: string;
  source: string;
  reason: string;
  createdAt: number;
}

// Live view of the paper soak. `running: false` with everything else null is the
// normal idle state — the soak only exists between an explicit start and stop.
export interface DashboardSoak {
  running: boolean;
  runId: string | null;
  startedAt: number | null;

  zone: string | null;
  zoneReason: string | null;
  harvestAggression: "FULL" | "REDUCED" | null;
  breakoutCandidate: boolean;
  allowed: {
    harvestSell: boolean;
    harvestRebuy: boolean;
    accumulationBuy: boolean;
    accumulationRecoverySell: boolean;
  } | null;

  // Virtual position (paper only — never the real treasury)
  zig: number;
  usdt: number;
  activeZig: number;
  reserveZig: number;
  avgCost: number;
  markPrice: number | null;

  nav: number | null;
  baselineNav: number | null;
  navDelta: number | null;

  harvest: {
    openCycles: number;
    completedCycles: number;
    completionRate: number;
    harvestedUsdt: number;
    unrecoveredZig: number;
    nearestRebuyTarget: number | null;
    sells: number;
    buys: number;
  };

  accumulation: {
    enabled: boolean;
    openLots: number;
    recoveredLots: number;
    usdtDeployed: number;
    usdtRecovered: number;
    surplusZig: number;
    openExposureUsdt: number;
    budgetRemaining: number;
    dailyRemaining: number;
    recycled: number;
  } | null;

  recentFills: Array<{ side: "buy" | "sell"; qty: number; price: number; at: number; kind: string }>;
  blocked: Array<{ reason: string; count: number }>;
}

// The operator's zone boundaries, sent to the dashboard so the chart draws the
// SAME bands the engine classifies against. Hardcoding them client-side meant a
// config change would leave the picture silently disagreeing with behaviour —
// the one thing this chart exists to explain.
export interface DashboardZones {
  activeBandLow: number;
  activeBandHigh: number;
  zoneALow: number;
  zoneAHigh: number;
  zoneBLow: number;
  zoneBHigh: number;
  zoneCLow: number;
  zoneCHigh: number;
  reserveFloor: number;
}

export interface DashboardPayload {
  mode: string;
  hasSession: boolean;
  symbol: string;
  zones: DashboardZones;
  exchanges: { bybit: DashboardExchange; mexc: DashboardExchange };
  account: DashboardAccountState;
  treasury: DashboardTreasury | null;
  execution: { managedOrders: DashboardManagedOrder[] };
  soak: DashboardSoak;
  events: DashboardEvent[];
  startedAt: number;
  updatedAt: number;
}

export class ApiServer {
  private wss: WebSocketServer | null = null;
  private snapshotProvider: (() => DashboardPayload) | null = null;
  private readonly log: Logger;
  private readonly eventRing: DashboardEvent[] = [];
  private readonly routes = new Map<string, RouteHandler>();
  private readonly opts: ApiServerOptions;

  // Control routes: 10 requests / minute per ip+route. Guards against loops/spam.
  private readonly controlLimiter = new RateLimiter(10, 60_000);

  constructor(log: Logger, opts: ApiServerOptions) {
    this.log = log.child({ module: "api-server" });
    this.opts = opts;
  }

  route(method: Method, path: string, handler: RouteHandler): void {
    this.routes.set(`${method} ${path}`, handler);
  }

  addEvent(level: DashboardEvent["level"], msg: string): void {
    this.eventRing.unshift({ time: new Date().toISOString(), level, msg });
    if (this.eventRing.length > 100) this.eventRing.pop();
  }

  getEvents(): DashboardEvent[] {
    return [...this.eventRing];
  }

  broadcast(payload: DashboardPayload): void {
    if (!this.wss) return;
    const msg = JSON.stringify({ type: "STATE_UPDATE", data: payload });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  }

  // State is pushed on engine events, so without this a dashboard that connects
  // during a quiet moment renders an empty shell until something happens to
  // broadcast. Supplying a snapshot lets a new client be served immediately.
  setSnapshotProvider(provider: () => DashboardPayload): void {
    this.snapshotProvider = provider;
  }

  private sendSnapshot(ws: WebSocket): void {
    if (!this.snapshotProvider || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: "STATE_UPDATE", data: this.snapshotProvider() }));
    } catch (err) {
      this.log.warn({ err }, "Failed to send initial snapshot");
    }
  }

  start(host: string, port: number): void {
    const server = createServer((req, res) => {
      // CORS — locked to the configured dashboard origin (not "*")
      res.setHeader("Access-Control-Allow-Origin", this.opts.dashboardOrigin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-operator-token");
      res.setHeader("Access-Control-Allow-Credentials", "true");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.url === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, time: Date.now() }));
        return;
      }

      const path = (req.url ?? "").split("?")[0];
      const routeKey = `${req.method} ${path}`;
      const handler = this.routes.get(routeKey);
      if (!handler) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      void this.dispatch(req, res, path, handler).catch((err) => {
        this.log.error({ err }, "API dispatch failed");
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal error" }));
        }
      });
    });

    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.wss.on("connection", (ws, req) => {
      // Serve the current state only AFTER authorisation resolves — otherwise an
      // unauthorised socket would receive a full state payload before being closed.
      void this.authorizeWs(ws, req).then((authorised) => {
        if (authorised) this.sendSnapshot(ws);
      });
      this.log.info({ ip: clientIp(req) }, "Dashboard client connected");
      ws.on("close", () => this.log.info("Dashboard client disconnected"));
      ws.on("error", (err) => this.log.warn({ err }, "Dashboard WS error"));
    });

    server.listen(port, host, () => {
      this.log.info({ host, port }, "API server listening");
      if (!this.opts.operatorToken) {
        this.log.warn("OPERATOR_TOKEN not set — all control routes are DISABLED (fail closed)");
      }
    });
  }

  // Resolves to whether the socket may receive state.
  private async authorizeWs(ws: WebSocket, req: IncomingMessage): Promise<boolean> {
    if (!this.opts.validateSessionToken) return true;
    const cookies = parseCookies(headerValue(req, "cookie"));
    const ok = await this.opts.validateSessionToken(cookies[this.opts.sessionCookieName ?? "zig_session"]);
    if (!ok) {
      ws.close(1008, "Unauthorized");
      return false;
    }
    return true;
  }

  private async dispatch(req: IncomingMessage, res: ServerResponse, path: string, handler: RouteHandler): Promise<void> {
    const ip = clientIp(req);
    const cookies = parseCookies(headerValue(req, "cookie"));
    const send = (status: number, payload: unknown, headers?: Record<string, string | string[]>) => {
      if (res.headersSent) return;
      res.writeHead(status, { "Content-Type": "application/json", ...(headers ?? {}) });
      res.end(JSON.stringify(payload));
    };

    const isControl = path.startsWith(OPERATOR_PREFIX);
    const isProtectedRead = path.startsWith("/api/public/");

    if (isProtectedRead && this.opts.validateSessionToken) {
      const ok = await this.opts.validateSessionToken(cookies[this.opts.sessionCookieName ?? "zig_session"]);
      if (!ok) return send(401, { error: "Unauthorized" });
    }

    // ── Control-route gating (rate limit → token), enforced BEFORE body read ──
    if (isControl) {
      if (!this.controlLimiter.check(`${ip}:${path}`)) {
        this.opts.audit.record({ action: "RATE_LIMITED", ip, success: false, detail: path });
        return send(429, { error: "Rate limit exceeded" });
      }

      const token = headerValue(req, "x-operator-token");
      const check = verifyOperatorToken(this.opts.operatorToken, token);
      if (!check.ok) {
        this.opts.audit.record({ action: "OPERATOR_AUTH_FAIL", ip, success: false, detail: check.reason });
        const status = check.reason === "not_configured" ? 503 : 401;
        const error =
          check.reason === "not_configured"
            ? "Control plane disabled — OPERATOR_TOKEN not configured"
            : "Unauthorized";
        return send(status, { error });
      }
    }

    // ── Body read with hard size cap ──────────────────────────────────────────
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;

    req.on("data", (c: Buffer) => {
      if (aborted) return;
      total += c.length;
      if (total > MAX_BODY_BYTES) {
        aborted = true;
        send(413, { error: "Payload too large" });
        req.destroy();
        return;
      }
      chunks.push(c);
    });

    req.on("end", () => {
      if (aborted) return;

      let body: unknown = undefined;
      if (chunks.length > 0) {
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return send(400, { error: "Invalid JSON body" });
        }
      }

      Promise.resolve(handler({ body, ip, operator: isControl, cookies, send })).catch((err: unknown) => {
        this.log.error({ err }, "Route handler error");
        send(500, { error: "Internal error" });
      });
    });
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function clientIp(req: IncomingMessage): string {
  // Behind a reverse proxy, trust the first x-forwarded-for hop.
  const fwd = headerValue(req, "x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}
