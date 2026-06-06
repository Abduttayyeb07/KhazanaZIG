"use client";

import type { DashboardTreasury } from "@/types";

interface Props {
  treasury: DashboardTreasury | null;
}

function fmtAmount(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtPrice(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

function fmtUsd(n: number | null): string {
  if (n === null) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function pnlColor(n: number | null): string {
  if (n === null) return "text-zinc-400";
  if (n > 0) return "text-emerald-400";
  if (n < 0) return "text-red-400";
  return "text-zinc-300";
}

export function TreasuryPanel({ treasury }: Props) {
  if (!treasury || treasury.fillCount === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-white font-semibold text-sm">Treasury</span>
          <span className="text-zinc-600 text-xs font-mono">no fills yet</span>
        </div>
        <p className="text-zinc-600 text-xs">
          Treasury state is derived from fill history. Once trades fill, inventory, cost basis,
          and harvested PnL appear here.
        </p>
      </div>
    );
  }

  const t = treasury;
  // Active/reserve bar proportions
  const total = t.totalBase || 1;
  const reservePct = Math.min((t.reserveBase / total) * 100, 100);
  const activePct = Math.min((t.activeBase / total) * 100, 100);

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-white font-semibold text-sm">Treasury</span>
        <span className="text-zinc-600 text-xs font-mono">{t.fillCount} fills · {t.baseAsset}/{t.quoteAsset}</span>
      </div>

      {/* Inventory split */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-emerald-400">Active {fmtAmount(t.activeBase)}</span>
          <span className="text-blue-400">Reserve {fmtAmount(t.reserveBase)}</span>
        </div>
        <div className="h-2 bg-surface rounded-full overflow-hidden flex">
          <div className="h-full bg-emerald-500" style={{ width: `${activePct}%` }} />
          <div className="h-full bg-blue-500" style={{ width: `${reservePct}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
          <span>harvestable</span>
          <span>floor {fmtAmount(t.reserveFloor)} · protected</span>
        </div>
      </div>

      {/* Key financials */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label={`Total ${t.baseAsset}`} value={fmtAmount(t.totalBase)} />
        <Metric label="Avg Cost" value={fmtPrice(t.avgCost)} sub={t.quoteAsset} />
        <Metric label="Mark" value={fmtPrice(t.markPrice)} sub={t.quoteAsset} />
        <Metric label="Inventory Value" value={fmtUsd(t.inventoryValueUsdt)} />
      </div>

      {/* PnL row */}
      <div className="grid grid-cols-3 gap-3 pt-3 border-t border-border">
        <div>
          <p className="text-zinc-500 text-xs mb-0.5">Harvested (realized)</p>
          <p className={`font-mono text-base font-semibold ${pnlColor(t.realizedPnlUsdt)}`}>
            {fmtUsd(t.realizedPnlUsdt)}
          </p>
        </div>
        <div>
          <p className="text-zinc-500 text-xs mb-0.5">Unrealized</p>
          <p className={`font-mono text-base font-semibold ${pnlColor(t.unrealizedPnlUsdt)}`}>
            {fmtUsd(t.unrealizedPnlUsdt)}
          </p>
        </div>
        <div>
          <p className="text-zinc-500 text-xs mb-0.5">Fees paid</p>
          <p className="font-mono text-base text-zinc-300">{fmtUsd(t.totalFeesUsdt)}</p>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface rounded-lg p-3">
      <p className="text-zinc-500 text-xs mb-1">{label}</p>
      <p className="text-white font-mono text-sm font-semibold">{value}</p>
      {sub && <p className="text-zinc-600 text-[10px] mt-0.5">{sub}</p>}
    </div>
  );
}
