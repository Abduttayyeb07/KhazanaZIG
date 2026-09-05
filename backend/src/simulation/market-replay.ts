import type { Exchange, NormalizedMarketState, VolatilityRegime } from "@zig/shared-types";
import type { Candle } from "./fetch-history.js";

// ── Market replay ───────────────────────────────────────────────────────────────
//
// Turns REAL hourly ZIG candles into the per-tick NormalizedMarketState the engine
// consumes. Deep ZIG history only exists at hourly resolution (see fetch-history.ts),
// but the driver ticks every 30s, so each real candle is expanded into sub-ticks.
//
// The expansion is a Brownian bridge pinned to the candle's REAL open/high/low/close:
// the path starts at the real open, is forced to touch the real high and the real low,
// and ends at the real close. Noise between those anchors is scaled to the observed
// 1-minute return stdev. So the price journey is real; only the ordering of ticks
// inside an hour is modelled. That matters for a harvester, which monetises exactly
// this intra-hour oscillation — replaying hourly closes alone would understate it.
//
// Spread and depth are MODELLED, not replayed: klines carry no book. Both are
// calibrated to the live ZIG book measured 2026-09-04 (see CALIBRATION below), and
// spread is what production's normalizer turns into the volatility regime, so this
// is the most behaviour-critical model here. It is deliberately conservative.
// ──────────────────────────────────────────────────────────────────────────────

// Measured from the live books on 2026-09-04:
//   MEXC  spread 22.6 bps · top-10 depth 52,817 ZIG bid / 17,956 ZIG ask (~2,185 / ~750 USDT)
//   Gate  spread  2.4 bps · top-10 depth 21,554 ZIG bid / 14,818 ZIG ask
// MEXC is the conservative venue of the two and matches the pair we actually trade.
export const CALIBRATION = {
  // Base spread was originally 22.6 bps, taken from a SINGLE book snapshot. That
  // snapshot caught an unusually wide moment: 10 consecutive samples taken later
  // all read 4.68 bps, and the median 1-minute high-low range over the cached
  // minute series is 7.4 bps.
  //
  // The error was not cosmetic. Production derives the volatility regime from
  // spread alone (<5 LOW, <20 NORMAL, <60 HIGH), so a 22.6 bps floor pinned every
  // simulated tick to HIGH, which then (a) blocked accumulation via
  // ACCUMULATION_ALLOW_IN_HIGH_VOL and (b) applied the 0.40 HIGH-vol size
  // multiplier to every order — the source of the ~1M
  // VOLATILITY_MULTIPLIER → BELOW_MIN_ORDER_ZIG rejections. One bad constant
  // produced both headline pathologies.
  baseSpreadBps: 4.7,
  // Spread widens with realised volatility. Coefficient chosen so a calm hour sits
  // near the measured base and a violent one (hourly range ~3%, the observed p90)
  // reaches the CHAOTIC boundary the normalizer uses (60 bps).
  spreadVolCoefficient: 1_250,
  maxSpreadBps: 400,
  // NOTE THE UNITS. NormalizedMarketState.bidLiquidity/askLiquidity are USDT
  // NOTIONAL, not ZIG: OrderbookEngine sums size × price, and risk-context divides
  // by the top-of-book price to recover a ZIG quantity for the sizing cap.
  //
  // This replay originally emitted ZIG here, so risk-context divided an already-ZIG
  // figure by ~0.042 and saw ~24x more depth than exists. Order sizes — and every
  // harvest number derived from them — were inflated accordingly.
  // Measured 2026-09-04 on MEXC: 52,817 ZIG bid ≈ 2,185 USDT · 17,956 ZIG ask ≈ 750 USDT.
  // Medians of 10 consecutive top-10 book samples (the single earlier snapshot read
  // 2,185 / 750, which was not representative).
  bidDepthUsdt: 1_493,
  askDepthUsdt: 944,
  // 1m return stdev measured over the cached minute series.
  minuteReturnStdev: 0.003409,
} as const;

// Mirrors backend/src/exchange/*/normalizer.ts exactly. Duplicated deliberately:
// the normalizers derive it from a live OrderbookEngine we do not have here, and the
// simulation must classify regimes the same way production does or the zone manager
// sees a different world than it would in a real soak.
export function classifyVolatility(spreadBps: number): VolatilityRegime {
  if (spreadBps < 5) return "LOW";
  if (spreadBps < 20) return "NORMAL";
  if (spreadBps < 60) return "HIGH";
  return "CHAOTIC";
}

// Deterministic RNG (mulberry32) so any run is reproducible from its seed alone.
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Tick {
  at: number;   // virtual epoch ms
  price: number;
}

// Expand one real candle into `steps` sub-prices that honour its real O/H/L/C.
export function expandCandle(candle: Candle, steps: number, rng: () => number): number[] {
  if (steps <= 1) return [candle.c];

  // Random walk from open to close, then bridge-corrected so it lands exactly on close.
  const sigma = CALIBRATION.minuteReturnStdev * Math.sqrt(60 / steps);
  const raw: number[] = [candle.o];
  for (let i = 1; i < steps; i++) {
    const shock = (rng() * 2 - 1) * sigma * Math.sqrt(3); // uniform with matching variance
    raw.push(Math.max(raw[i - 1] * (1 + shock), 1e-9));
  }

  // Brownian bridge: remove the drift error linearly so the last point is the close.
  const drift = candle.c - raw[raw.length - 1];
  const bridged = raw.map((p, i) => p + (drift * i) / (steps - 1));

  // Rescale the interior so the path actually touches the real high and low. Without
  // this the simulated hour is calmer than the hour that really happened, and a
  // harvester's whole edge lives in those extremes.
  const lo = Math.min(...bridged);
  const hi = Math.max(...bridged);
  const span = hi - lo;
  const realSpan = candle.h - candle.l;
  if (span > 1e-12 && realSpan > 0) {
    const scale = realSpan / span;
    const mid = (candle.h + candle.l) / 2;
    const centre = (hi + lo) / 2;
    for (let i = 0; i < bridged.length; i++) {
      bridged[i] = mid + (bridged[i] - centre) * scale;
    }
    // Re-pin the endpoints, which the rescale moved off open/close.
    bridged[0] = candle.o;
    bridged[bridged.length - 1] = candle.c;
  }

  return bridged.map((p) => Math.min(Math.max(p, candle.l), candle.h));
}

// Realised volatility of the last `lookback` ticks → the spread the book would show.
function spreadBpsFor(recent: number[]): number {
  if (recent.length < 2) return CALIBRATION.baseSpreadBps;
  const lo = Math.min(...recent);
  const hi = Math.max(...recent);
  const mid = (hi + lo) / 2;
  const range = mid > 0 ? (hi - lo) / mid : 0;
  return Math.min(CALIBRATION.baseSpreadBps + range * CALIBRATION.spreadVolCoefficient, CALIBRATION.maxSpreadBps);
}

export interface ReplayOptions {
  exchange: Exchange;
  symbol: string;
  tickSeconds: number;
  seed: number;
}

// Produces the full NormalizedMarketState stream for a window of real candles.
export function* replay(candles: Candle[], opts: ReplayOptions): Generator<NormalizedMarketState> {
  const rng = makeRng(opts.seed);
  const stepsPerCandle = Math.max(1, Math.round(3_600 / opts.tickSeconds));
  const recent: number[] = [];
  let sequence = 0;

  for (const candle of candles) {
    const prices = expandCandle(candle, stepsPerCandle, rng);
    const dt = 3_600_000 / prices.length;

    for (let i = 0; i < prices.length; i++) {
      const price = prices[i];
      recent.push(price);
      if (recent.length > 20) recent.shift();

      const spreadBps = spreadBpsFor(recent);
      const halfSpread = (price * spreadBps) / 20_000;
      const bestBid = price - halfSpread;
      const bestAsk = price + halfSpread;
      const midPrice = (bestBid + bestAsk) / 2;

      // Depth tracks traded volume relative to the cached median, floored so a quiet
      // candle never reports a book of zero.
      const volScale = Math.max(0.2, Math.min(candle.v / 4_424, 5));
      const bidLiquidity = CALIBRATION.bidDepthUsdt * volScale;
      const askLiquidity = CALIBRATION.askDepthUsdt * volScale;
      const total = bidLiquidity + askLiquidity;

      yield {
        exchange: opts.exchange,
        symbol: opts.symbol,
        timestamp: candle.t + i * dt,
        bestBid,
        bestAsk,
        spread: bestAsk - bestBid,
        spreadBps,
        midPrice,
        bidLiquidity,
        askLiquidity,
        imbalanceRatio: total > 0 ? (bidLiquidity - askLiquidity) / total : 0,
        volatilityRegime: classifyVolatility(spreadBps),
        orderbookFreshnessMs: 0,
        websocketStatus: "CONNECTED",
        sequenceStatus: "HEALTHY",
        lastSequence: ++sequence,
      };
    }
  }
}
