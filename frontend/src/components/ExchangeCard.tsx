"use client";

import type { DashboardExchange } from "@/types";

interface Props {
  name: string;
  data: DashboardExchange;
}

const statusColor = {
  CONNECTED: "bg-emerald-500",
  RECONNECTING: "bg-yellow-400",
  DISCONNECTED: "bg-red-500",
};

const statusText = {
  CONNECTED: "text-emerald-400",
  RECONNECTING: "text-yellow-400",
  DISCONNECTED: "text-red-400",
};

const regimeBadge: Record<string, string> = {
  LOW: "bg-blue-900/50 text-blue-300 border-blue-800",
  NORMAL: "bg-emerald-900/50 text-emerald-300 border-emerald-800",
  HIGH: "bg-yellow-900/50 text-yellow-300 border-yellow-800",
  CHAOTIC: "bg-red-900/50 text-red-300 border-red-800",
};

function fmt(n: number | null, decimals = 6): string {
  if (n === null) return "—";
  return n.toFixed(decimals);
}

function fmtBps(n: number | null): string {
  if (n === null) return "—";
  return n.toFixed(2) + " bps";
}

function fmtFreshness(ms: number | null): { text: string; color: string } {
  if (ms === null) return { text: "—", color: "text-zinc-500" };
  if (ms < 500) return { text: ms + "ms", color: "text-emerald-400" };
  if (ms < 2000) return { text: ms + "ms", color: "text-yellow-400" };
  return { text: ms + "ms", color: "text-red-400" };
}

export function ExchangeCard({ name, data }: Props) {
  const freshness = fmtFreshness(data.freshnessMs);

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-white font-semibold text-lg tracking-wide">{name}</span>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${statusColor[data.wsStatus]} ${data.wsStatus === "CONNECTED" ? "animate-pulse_slow" : ""}`} />
          <span className={`text-xs font-mono ${statusText[data.wsStatus]}`}>{data.wsStatus}</span>
        </div>
      </div>

      {/* Price grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-surface rounded-lg p-3">
          <p className="text-zinc-500 text-xs mb-1">Best Bid</p>
          <p className="text-emerald-400 font-mono text-base font-semibold">{fmt(data.bestBid)}</p>
        </div>
        <div className="bg-surface rounded-lg p-3">
          <p className="text-zinc-500 text-xs mb-1">Best Ask</p>
          <p className="text-red-400 font-mono text-base font-semibold">{fmt(data.bestAsk)}</p>
        </div>
        <div className="bg-surface rounded-lg p-3">
          <p className="text-zinc-500 text-xs mb-1">Mid Price</p>
          <p className="text-white font-mono text-sm">{fmt(data.midPrice)}</p>
        </div>
        <div className="bg-surface rounded-lg p-3">
          <p className="text-zinc-500 text-xs mb-1">Spread</p>
          <p className="text-violet-300 font-mono text-sm">{fmtBps(data.spreadBps)}</p>
        </div>
      </div>

      {/* Imbalance bar */}
      {data.imbalanceRatio !== null && (
        <div>
          <div className="flex justify-between text-xs text-zinc-500 mb-1">
            <span>Buy Pressure</span>
            <span>Sell Pressure</span>
          </div>
          <div className="h-1.5 bg-surface rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-red-500 rounded-full transition-all duration-300"
              style={{ width: `${((data.imbalanceRatio + 1) / 2) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-border">
        {data.regime ? (
          <span className={`text-xs font-mono px-2 py-0.5 rounded border ${regimeBadge[data.regime] ?? regimeBadge.NORMAL}`}>
            {data.regime}
          </span>
        ) : (
          <span className="text-zinc-600 text-xs">—</span>
        )}
        <span className={`text-xs font-mono ${freshness.color}`}>
          ⏱ {freshness.text}
        </span>
      </div>
    </div>
  );
}
