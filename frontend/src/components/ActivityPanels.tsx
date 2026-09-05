"use client";

import type { DashboardSoak } from "@/types";
import { fmtCompact, fmtNum, fmtPrice } from "./StatCard";

// ── Zone + permissions ──────────────────────────────────────────────────────────
// When nothing is trading this is the panel that explains it. "No fills" and
// "sells are not permitted in this zone" look identical in a fill list.
export function ZonePanel({ soak }: { soak: DashboardSoak }) {
  const a = soak.allowed;
  const actions: Array<[string, boolean | undefined]> = [
    ["Sell", a?.harvestSell],
    ["Rebuy", a?.harvestRebuy],
    ["Acc buy", a?.accumulationBuy],
    ["Recover", a?.accumulationRecoverySell],
  ];

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">Zone</h2>
        {soak.harvestAggression && (
          <span className={`chip ${soak.harvestAggression === "FULL"
            ? "border-pos/30 bg-pos/10 text-pos"
            : "border-warn/30 bg-warn/10 text-warn"}`}>
            {soak.harvestAggression}
          </span>
        )}
      </div>

      <div className="p-3.5 space-y-3">
        <div>
          <p className="text-sm font-semibold text-ink">
            {soak.zone ? soak.zone.replaceAll("_", " ") : "Not evaluated"}
          </p>
          <p className="text-2xs text-muted mt-0.5 leading-snug">
            {soak.zoneReason ?? (soak.running ? "Awaiting first evaluation." : "Evaluates only while running.")}
          </p>
        </div>

        {soak.breakoutCandidate && (
          <p className="text-2xs text-warn bg-warn/10 border border-warn/25 rounded px-2 py-1.5">
            Above band — harvesting inventory, not chasing.
          </p>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          {actions.map(([name, allowed]) => (
            <div key={name}
                 className={`flex items-center gap-1.5 rounded px-2 py-1.5 text-2xs border ${
                   allowed ? "border-pos/25 bg-pos/[0.06] text-ink" : "border-line bg-canvas text-muted"
                 }`}>
              <span className={`w-1 h-1 rounded-full shrink-0 ${allowed ? "bg-pos" : "bg-muted"}`} />
              {name}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Harvest cycles ──────────────────────────────────────────────────────────────
// Closed round-trips, not raw PnL: a sell without its rebuy is an open obligation.
export function HarvestPanel({ soak }: { soak: DashboardSoak }) {
  const h = soak.harvest;
  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">Harvest</h2>
        <span className="text-2xs text-muted font-mono">{(h.completionRate * 100).toFixed(0)}% closed</span>
      </div>
      <div className="p-3.5 divide-y divide-line">
        <KV label="Open / closed" value={`${h.openCycles} / ${h.completedCycles}`} />
        <KV label="Sells" value={String(h.sells)} tone="text-neg" />
        <KV label="Rebuys" value={String(h.buys)} tone="text-pos" />
        <KV label="Harvested" value={`${fmtNum(h.harvestedUsdt)} USDT`} tone="text-accent-soft" />
        <KV label="Unrecovered" value={`${fmtCompact(h.unrecoveredZig)} ZIG`} />
        <KV label="Next rebuy" value={h.nearestRebuyTarget != null ? `≤ ${fmtPrice(h.nearestRebuyTarget)}` : "—"} />
      </div>
    </div>
  );
}

// ── Accumulation ────────────────────────────────────────────────────────────────
// Never shows profit before principal is recovered; until then it is exposure.
export function AccumulationPanel({ soak }: { soak: DashboardSoak }) {
  const acc = soak.accumulation;
  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">Accumulation</h2>
        <span className={`chip ${acc ? "border-pos/30 bg-pos/10 text-pos" : "border-line bg-canvas text-muted"}`}>
          {acc ? "on" : "off"}
        </span>
      </div>
      {!acc ? (
        <p className="p-3.5 text-2xs text-muted">Disabled in configuration.</p>
      ) : (
        <div className="p-3.5 divide-y divide-line">
          <KV label="Open / recovered" value={`${acc.openLots} / ${acc.recoveredLots}`} />
          <KV label="Deployed" value={`${fmtNum(acc.usdtDeployed)} USDT`} />
          <KV label="Reclaimed" value={`${fmtNum(acc.usdtRecovered)} USDT`} tone="text-pos" />
          <KV label="Surplus ZIG" value={fmtCompact(acc.surplusZig)} tone="text-accent-soft"
              hint="Counted only after principal is fully recovered" />
          <KV label="Open exposure" value={`${fmtNum(acc.openExposureUsdt)} USDT`}
              tone={acc.openExposureUsdt > 0 ? "text-warn" : undefined} />
          <KV label="Budget left" value={`${fmtNum(acc.budgetRemaining)} USDT`} />
        </div>
      )}
    </div>
  );
}

// ── Fills ───────────────────────────────────────────────────────────────────────
export function FillsPanel({ soak }: { soak: DashboardSoak }) {
  return (
    <div className="card overflow-hidden">
      <div className="card-head">
        <h2 className="card-title">Fills</h2>
        <span className="text-2xs text-muted">{soak.recentFills.length}</span>
      </div>
      {soak.recentFills.length === 0 ? (
        <p className="p-3.5 text-2xs text-muted">
          {soak.running ? "None yet in this run." : "Start the simulation to generate fills."}
        </p>
      ) : (
        <div className="max-h-56 overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-panel">
              <tr>
                {["Side", "Qty", "Price", "Value", "Time"].map((h) => (
                  <th key={h} className="label font-medium text-left px-3.5 py-1.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="text-2xs">
              {soak.recentFills.map((f, i) => (
                <tr key={`${f.at}-${i}`} className="border-t border-line">
                  <td className="px-3.5 py-1.5">
                    <span className={`font-semibold ${f.side === "sell" ? "text-neg" : "text-pos"}`}>
                      {f.side.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3.5 py-1.5 font-mono tabular text-secondary">{fmtCompact(f.qty)}</td>
                  <td className="px-3.5 py-1.5 font-mono tabular text-secondary">{fmtPrice(f.price)}</td>
                  <td className="px-3.5 py-1.5 font-mono tabular text-muted">{fmtNum(f.qty * f.price)}</td>
                  <td className="px-3.5 py-1.5 font-mono text-muted">
                    {new Date(f.at).toLocaleTimeString("en-US", { hour12: false })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Why nothing happened ────────────────────────────────────────────────────────
export function BlockedPanel({ soak }: { soak: DashboardSoak }) {
  const top = soak.blocked[0]?.count ?? 1;
  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">Blocked intents</h2>
      </div>
      {soak.blocked.length === 0 ? (
        <p className="p-3.5 text-2xs text-muted">Nothing blocked yet.</p>
      ) : (
        <div className="p-3.5 space-y-2">
          {soak.blocked.slice(0, 6).map((b) => (
            <div key={b.reason}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-2xs text-secondary font-mono truncate">{b.reason}</span>
                <span className="text-2xs text-muted tabular shrink-0">{b.count.toLocaleString()}</span>
              </div>
              <div className="h-0.5 mt-1 rounded-full bg-line overflow-hidden">
                <div className="h-full bg-accent/50 rounded-full"
                     style={{ width: `${Math.max(3, (b.count / top) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KV({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="kv" title={hint}>
      <span className="text-2xs text-muted">{label}</span>
      <span className={`metric text-xs ${tone ?? "text-ink"}`}>{value}</span>
    </div>
  );
}
