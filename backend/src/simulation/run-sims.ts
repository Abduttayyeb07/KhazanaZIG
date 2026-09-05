import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@zig/config";
import { createLogger } from "@zig/logger";
import type { Candle } from "./fetch-history.js";
import { seriesPath, dataDir } from "./fetch-history.js";
import { makeRng } from "./market-replay.js";
import { runSimulation, type SimResult } from "./sim-harness.js";

// ── 10k-run sweep ───────────────────────────────────────────────────────────────
//
// Samples random windows from ~400 days of REAL hourly ZIG history and replays each
// through the real engine. Because the history is finite, 10,000 distinct windows
// are drawn by bootstrap resampling — random start offset and random window length —
// so runs overlap. That is a real limitation: the runs are NOT independent, and a
// single unusual week is reused across many of them. The per-zone breakdown exists
// so results can be read per market condition rather than as one blended average.
//
// Pass/fail is the safety invariants (see invariants.ts). Profitability is reported
// alongside but never determines pass.
//
//   npm run sim            → 10,000 runs
//   npm run sim -- 500     → 500 runs (quick)
// ──────────────────────────────────────────────────────────────────────────────

const log = createLogger("sim", "error"); // engine logs silenced; the sweep prints its own

interface Summary {
  runs: number;
  passed: number;
  failed: number;
  breachCounts: Record<string, number>;
  beatHold: number;
  navVsHold: number[];
  harvested: number[];
  surplus: number[];
  totalHarvestSells: number;
  totalHarvestBuys: number;
  totalAccBuys: number;
  totalAccRecoveries: number;
  runsWithNoFills: number;
  zoneFlipFills: number;
  zoneFlipQty: number;
  runsWithZoneFlip: number;
  promotions: number;
  demotions: number;
  reloadedZig: number;
  runsWithPromotion: number;
  blocked: Map<string, number>;
  rejects: Map<string, number>;
  relaxations: Map<string, number>;
  zoneTicks: Map<string, number>;
  byZone: Map<string, { runs: number; navVsHold: number[]; fills: number }>;
}

function pct(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * s.length)))];
}
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const fmt = (n: number): string => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

// The zone the window spent most of its time in — the run's market character.
function dominantZone(r: SimResult): string {
  const entries = Object.entries(r.zoneTicks);
  if (entries.length === 0) return "NONE";
  return entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}

async function main(): Promise<void> {
  const cfg = getConfig();
  const runs = Number(process.argv[2] ?? 10_000);

  const raw = await readFile(seriesPath("1h"), "utf8").catch(() => null);
  if (!raw) {
    console.error("No cached history. Run:  npx tsx src/simulation/fetch-history.ts");
    process.exit(1);
  }
  const candles: Candle[] = JSON.parse(raw).candles;

  const MIN_WINDOW = 24 * 7;   // 1 week
  const MAX_WINDOW = 24 * 30;  // 30 days
  if (candles.length < MAX_WINDOW + 10) {
    console.error(`History too short: ${candles.length} candles`);
    process.exit(1);
  }

  console.log(`\nZIG Treasury — replay simulation`);
  console.log(`  history : ${candles.length} real hourly candles (${(candles.length / 24).toFixed(0)} days)`);
  console.log(`            ${new Date(candles[0].t).toISOString().slice(0, 10)} → ${new Date(candles[candles.length - 1].t).toISOString().slice(0, 10)}`);
  console.log(`  window  : ${MIN_WINDOW}–${MAX_WINDOW}h, randomly sampled (bootstrap; runs overlap)`);
  console.log(`  capital : ${fmt(cfg.SOAK_VIRTUAL_ZIG)} ZIG (reserve ${fmt(cfg.RESERVE_FLOOR)}) + ${fmt(cfg.SOAK_VIRTUAL_USDT)} USDT`);
  console.log(`  runs    : ${fmt(runs)}\n`);

  const s: Summary = {
    runs: 0, passed: 0, failed: 0, breachCounts: {}, beatHold: 0,
    navVsHold: [], harvested: [], surplus: [],
    totalHarvestSells: 0, totalHarvestBuys: 0, totalAccBuys: 0, totalAccRecoveries: 0,
    runsWithNoFills: 0, zoneFlipFills: 0, zoneFlipQty: 0, runsWithZoneFlip: 0,
    promotions: 0, demotions: 0, reloadedZig: 0, runsWithPromotion: 0,
    blocked: new Map(), rejects: new Map(), relaxations: new Map(), zoneTicks: new Map(),
    byZone: new Map(),
  };

  const pick = makeRng(20260904);
  const failures: SimResult[] = [];
  const started = Date.now();

  for (let i = 0; i < runs; i++) {
    const window = MIN_WINDOW + Math.floor(pick() * (MAX_WINDOW - MIN_WINDOW));
    const start = Math.floor(pick() * (candles.length - window));
    const slice = candles.slice(start, start + window);

    let r: SimResult;
    try {
      r = await runSimulation({
        cfg, candles: slice, seed: i + 1,
        exchange: cfg.SOAK_EXCHANGE,
        startZig: cfg.SOAK_VIRTUAL_ZIG,
        startUsdt: cfg.SOAK_VIRTUAL_USDT,
        log,
      });
    } catch (err) {
      s.runs++; s.failed++;
      const code = `THREW:${err instanceof Error ? err.message.slice(0, 60) : "unknown"}`;
      s.breachCounts[code] = (s.breachCounts[code] ?? 0) + 1;
      continue;
    }

    s.runs++;
    if (r.passed) s.passed++;
    else {
      s.failed++;
      if (failures.length < 5) failures.push(r);
      for (const b of r.breaches) s.breachCounts[b.code] = (s.breachCounts[b.code] ?? 0) + 1;
    }

    s.navVsHold.push(r.navVsHold);
    s.harvested.push(r.harvestedUsdt);
    s.surplus.push(r.surplusZig);
    if (r.navVsHold > 0) s.beatHold++;
    s.totalHarvestSells += r.harvestSells;
    s.totalHarvestBuys += r.harvestBuys;
    s.totalAccBuys += r.accBuys;
    s.totalAccRecoveries += r.accRecoveries;
    const fills = r.harvestSells + r.harvestBuys + r.accBuys + r.accRecoveries;
    if (fills === 0) s.runsWithNoFills++;
    s.zoneFlipFills += r.zoneFlipFills;
    s.zoneFlipQty += r.zoneFlipQty;
    if (r.zoneFlipFills > 0) s.runsWithZoneFlip++;
    s.promotions += r.promotions;
    s.demotions += r.demotions;
    s.reloadedZig += r.reloadedZig;
    if (r.promotions > 0) s.runsWithPromotion++;

    for (const [k, v] of Object.entries(r.blockedReasons)) s.blocked.set(k, (s.blocked.get(k) ?? 0) + v);
    for (const [k, v] of Object.entries(r.rejectReasons)) s.rejects.set(k, (s.rejects.get(k) ?? 0) + v);
    for (const [k, v] of Object.entries(r.relaxations)) s.relaxations.set(k, (s.relaxations.get(k) ?? 0) + v);
    for (const [k, v] of Object.entries(r.zoneTicks)) s.zoneTicks.set(k, (s.zoneTicks.get(k) ?? 0) + v);

    const dz = dominantZone(r);
    const bucket = s.byZone.get(dz) ?? { runs: 0, navVsHold: [], fills: 0 };
    bucket.runs++; bucket.navVsHold.push(r.navVsHold); bucket.fills += fills;
    s.byZone.set(dz, bucket);

    if ((i + 1) % 250 === 0) {
      const rate = (i + 1) / ((Date.now() - started) / 1000);
      process.stdout.write(`\r  ${i + 1}/${runs} runs · ${s.failed} failed · ${rate.toFixed(1)}/s   `);
    }
  }

  const elapsed = (Date.now() - started) / 1000;
  process.stdout.write(`\r${" ".repeat(70)}\r`);

  // ── Report ────────────────────────────────────────────────────────────────
  console.log(`══════ SAFETY (pass/fail) ══════`);
  console.log(`  runs      : ${fmt(s.runs)}  in ${elapsed.toFixed(0)}s`);
  console.log(`  passed    : ${fmt(s.passed)}  (${((100 * s.passed) / Math.max(s.runs, 1)).toFixed(2)}%)`);
  console.log(`  FAILED    : ${fmt(s.failed)}`);
  if (Object.keys(s.breachCounts).length > 0) {
    console.log(`\n  Breaches by type:`);
    for (const [code, n] of Object.entries(s.breachCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${code.padEnd(38)} ${fmt(n)} run(s)`);
    }
    console.log(`\n  Example failures:`);
    for (const f of failures) {
      console.log(`    seed ${f.seed}: ${f.breaches.map((b) => `${b.code} (${b.detail})`).join(" · ")}`);
    }
  } else {
    console.log(`  No invariant breached in any run.`);
  }

  console.log(`\n══════ BEHAVIOUR ══════`);
  console.log(`  harvest fills  : ${fmt(s.totalHarvestSells)} sells / ${fmt(s.totalHarvestBuys)} buys`);
  console.log(`  accumulation   : ${fmt(s.totalAccBuys)} buys / ${fmt(s.totalAccRecoveries)} recoveries`);
  console.log(`  runs with ZERO fills : ${fmt(s.runsWithNoFills)} (${((100 * s.runsWithNoFills) / Math.max(s.runs, 1)).toFixed(1)}%)`);
  console.log(
    `\n  ⚠️ Zone-flip fills (legal when decided, filled after the zone turned against it):\n` +
    `     ${fmt(s.zoneFlipFills)} fills · ${fmt(s.zoneFlipQty)} ZIG · in ${fmt(s.runsWithZoneFlip)}/${fmt(s.runs)} runs (${((100 * s.runsWithZoneFlip) / Math.max(s.runs, 1)).toFixed(1)}%)\n` +
    `     Nothing withdraws a resting order when the zone changes.`
  );

  const zoneTotal = [...s.zoneTicks.values()].reduce((a, b) => a + b, 0) || 1;
  console.log(`\n  Time spent per zone:`);
  for (const [z, n] of [...s.zoneTicks.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${z.padEnd(32)} ${((100 * n) / zoneTotal).toFixed(1)}%`);
  }

  console.log(`\n  Top block reasons (why an intent never became an order):`);
  for (const [r, n] of [...s.blocked.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`    ${r.padEnd(34)} ${fmt(n)}`);
  }
  if (s.rejects.size > 0) {
    console.log(`\n  Top risk rejections:`);
    for (const [r, n] of [...s.rejects.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`    ${r.padEnd(34)} ${fmt(n)}`);
    }
  }
  if (s.relaxations.size > 0) {
    console.log(`\n  Paper-only allowances (NORMAL would refuse these):`);
    for (const [r, n] of [...s.relaxations.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${r.padEnd(34)} ${fmt(n)}`);
    }
  }

  console.log(`\n══════ P&L (reported, not pass/fail) ══════`);
  console.log(`  NAV vs simply holding, USDT:`);
  console.log(`    p5 ${fmt(pct(s.navVsHold, 5))} · p25 ${fmt(pct(s.navVsHold, 25))} · median ${fmt(pct(s.navVsHold, 50))} · p75 ${fmt(pct(s.navVsHold, 75))} · p95 ${fmt(pct(s.navVsHold, 95))}`);
  console.log(`    mean ${fmt(mean(s.navVsHold))} · worst ${fmt(Math.min(...s.navVsHold))} · best ${fmt(Math.max(...s.navVsHold))}`);
  console.log(`    beat hold in ${fmt(s.beatHold)}/${fmt(s.runs)} runs (${((100 * s.beatHold) / Math.max(s.runs, 1)).toFixed(1)}%)`);
  console.log(`  Harvested USDT (completed cycles): median ${fmt(pct(s.harvested, 50))} · mean ${fmt(mean(s.harvested))}`);
  console.log(`  Surplus ZIG (recovered accumulation): median ${fmt(pct(s.surplus, 50))} · mean ${fmt(mean(s.surplus))}`);

  console.log(`\n  By dominant market zone:`);
  console.log(`    ${"zone".padEnd(32)} ${"runs".padStart(7)} ${"median NAV vs hold".padStart(20)} ${"fills/run".padStart(11)}`);
  for (const [z, b] of [...s.byZone.entries()].sort((a, b) => b[1].runs - a[1].runs)) {
    console.log(`    ${z.padEnd(32)} ${String(b.runs).padStart(7)} ${fmt(pct(b.navVsHold, 50)).padStart(20)} ${(b.fills / b.runs).toFixed(1).padStart(11)}`);
  }

  await mkdir(dataDir(), { recursive: true });
  const out = path.join(dataDir(), "sim-summary.json");
  await writeFile(out, JSON.stringify({
    runs: s.runs, passed: s.passed, failed: s.failed, breachCounts: s.breachCounts,
    beatHoldPct: (100 * s.beatHold) / Math.max(s.runs, 1),
    navVsHold: { p5: pct(s.navVsHold, 5), median: pct(s.navVsHold, 50), p95: pct(s.navVsHold, 95), mean: mean(s.navVsHold) },
    blocked: Object.fromEntries(s.blocked), rejects: Object.fromEntries(s.rejects),
    relaxations: Object.fromEntries(s.relaxations), zoneTicks: Object.fromEntries(s.zoneTicks),
  }, null, 2));
  console.log(`\n  Summary written to ${out}\n`);

  process.exit(s.failed === 0 ? 0 : 1);
}

void main();
