import axios from "axios";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createLogger } from "@zig/logger";

// ── Historical ZIG market data fetcher ──────────────────────────────────────────
//
// Pulls REAL ZIGUSDT history for the replay simulator. Venue reality (probed
// 2026-09-04) drives the shape of this:
//
//   Bybit    — geo-blocked (CloudFront denies this region).
//   Binance  — geo-blocked (restricted location).
//   OKX      — does not list ZIG.
//   MEXC     — 500 candles per interval, `startTime` ignored, no pagination.
//              Useful only as a 500-day DAILY cross-check.
//   Gate.io  — paginated via `from`/`to`, but refuses anything more than 10,000
//              points ago. That caps 1m at ~7 days and 1h at ~416 days.
//
// So the deep history that exists for ZIG is HOURLY. We fetch:
//   • 1h over ~400 days  → the real macro price path (visits every zone)
//   • 1m over ~7 days    → real intra-hour microstructure, used to calibrate the
//                          sub-candle tick model rather than inventing volatility
//
// Both are cached to disk so the 10k-run sweep is offline and reproducible.
// ──────────────────────────────────────────────────────────────────────────────

const GATE = "https://api.gateio.ws/api/v4/spot/candlesticks";
const PAIR = "ZIG_USDT";
const MAX_POINTS_PER_REQUEST = 1000;
const GATE_MAX_POINTS_AGO = 10_000; // hard server limit — do not ask for more

export interface Candle {
  t: number; // ms, candle open
  o: number;
  h: number;
  l: number;
  c: number;
  v: number; // base volume (ZIG)
}

const log = createLogger("fetch-history", "info");

// Gate.io row order: [unix, quoteVolume, close, high, low, open, baseVolume, closed]
function toCandle(row: string[]): Candle {
  return {
    t: Number(row[0]) * 1_000,
    c: Number(row[2]),
    h: Number(row[3]),
    l: Number(row[4]),
    o: Number(row[5]),
    v: Number(row[6]),
  };
}

function intervalSeconds(interval: string): number {
  const n = Number(interval.slice(0, -1));
  const unit = interval.slice(-1);
  if (unit === "m") return n * 60;
  if (unit === "h") return n * 3_600;
  if (unit === "d") return n * 86_400;
  throw new Error(`Unsupported interval: ${interval}`);
}

// `from` + `limit`, never `from` + `to`: the range form counts BOTH endpoints, so a
// 1000-step window is 1001 points and Gate.io rejects the whole page
// ("Candlestick range too broad"). That failure silently truncated the first fetch
// to the most recent 25 days.
async function fetchWindow(interval: string, fromSec: number, limit: number): Promise<Candle[]> {
  const res = await axios.get<string[][]>(GATE, {
    params: { currency_pair: PAIR, interval, from: fromSec, limit },
    timeout: 30_000,
  });
  if (!Array.isArray(res.data)) return [];
  return res.data.map(toCandle).filter((c) => Number.isFinite(c.c) && c.c > 0);
}

// Walks forward from the oldest allowed point in MAX_POINTS_PER_REQUEST pages.
export async function fetchSeries(interval: string, days: number): Promise<Candle[]> {
  const step = intervalSeconds(interval);
  const nowSec = Math.floor(Date.now() / 1_000);

  // Never ask beyond the server's 10k-points-ago limit, or it 400s the whole page.
  const requestedPoints = Math.ceil((days * 86_400) / step);
  const points = Math.min(requestedPoints, GATE_MAX_POINTS_AGO - 5);
  if (requestedPoints > points) {
    log.warn({ interval, requestedPoints, cappedTo: points }, "Requested history exceeds venue limit - capping");
  }

  const startSec = nowSec - points * step;
  const byTime = new Map<number, Candle>();

  let failures = 0;
  for (let from = startSec; from < nowSec; from += MAX_POINTS_PER_REQUEST * step) {
    try {
      const page = await fetchWindow(interval, from, MAX_POINTS_PER_REQUEST);
      for (const c of page) byTime.set(c.t, c); // dedup on overlapping page edges
      log.info({ interval, got: page.length, total: byTime.size }, "Fetched page");
    } catch (err) {
      failures++;
      const detail = axios.isAxiosError(err) ? JSON.stringify(err.response?.data) : String(err);
      log.warn({ interval, from, detail }, "Page failed - continuing");
    }
    await sleep(250); // stay well inside Gate.io's public rate limit
  }

  // A partially-failed fetch silently produces a short history, which then quietly
  // shrinks the simulation's coverage. Surface it instead.
  if (failures > 0) log.warn({ interval, failures }, "Some pages failed - history may have gaps");

  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function dataDir(): string {
  return path.resolve(process.cwd(), "data");
}

export function seriesPath(interval: string): string {
  return path.join(dataDir(), `zig-${interval}.json`);
}

async function main(): Promise<void> {
  await mkdir(dataDir(), { recursive: true });

  for (const [interval, days] of [["1h", 400], ["1m", 7]] as const) {
    const candles = await fetchSeries(interval, days);
    if (candles.length === 0) {
      log.error({ interval }, "No candles fetched - aborting so we never write an empty cache");
      process.exitCode = 1;
      continue;
    }
    const spanDays = (candles[candles.length - 1].t - candles[0].t) / 86_400_000;
    await writeFile(
      seriesPath(interval),
      JSON.stringify({ pair: PAIR, interval, source: "gate.io", fetchedAt: Date.now(), candles }, null, 0)
    );
    log.warn(
      {
        interval,
        candles: candles.length,
        spanDays: Number(spanDays.toFixed(1)),
        first: new Date(candles[0].t).toISOString(),
        last: new Date(candles[candles.length - 1].t).toISOString(),
        low: Math.min(...candles.map((c) => c.l)),
        high: Math.max(...candles.map((c) => c.h)),
      },
      "Cached series"
    );
  }
}

if (process.argv[1]?.includes("fetch-history")) {
  void main();
}
