"use client";

import type { DashboardExchange } from "@/types";

interface Props {
  name: string;
  data: DashboardExchange;
}

const statusColor = {
  CONNECTED: "bg-emerald-500",
  RECONNECTING: "bg-yellow-400",
  DISCONNECTED: "bg-neg",
};

const statusText = {
  CONNECTED: "text-pos",
  RECONNECTING: "text-warn",
  DISCONNECTED: "text-neg",
};

const regimeBadge: Record<string, string> = {
  LOW: "bg-cyan/10 text-cyan border-cyan/20",
  NORMAL: "bg-pos/10 text-pos border-pos/20",
  HIGH: "bg-warn/10 text-warn border-warn/20",
  CHAOTIC: "bg-neg/10 text-neg border-neg/20",
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
  if (ms === null) return { text: "—", color: "text-muted" };
  if (ms < 500) return { text: ms + "ms", color: "text-pos" };
  if (ms < 2000) return { text: ms + "ms", color: "text-warn" };
  return { text: ms + "ms", color: "text-neg" };
}

export function ExchangeCard({ name, data }: Props) {
  const freshness = fmtFreshness(data.freshnessMs);

  return (
    <div className="card p-3.5 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-ink font-semibold text-lg tracking-wide">{name}</span>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${statusColor[data.wsStatus]} ${data.wsStatus === "CONNECTED" ? "animate-pulse_slow" : ""}`} />
          <span className={`text-xs font-mono ${statusText[data.wsStatus]}`}>{data.wsStatus}</span>
        </div>
      </div>

      {/* Price grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-raised border border-line rounded p-2.5">
          <p className="text-muted text-xs mb-1">Best Bid</p>
          <p className="text-pos font-mono text-base font-semibold">{fmt(data.bestBid)}</p>
        </div>
        <div className="bg-raised border border-line rounded p-2.5">
          <p className="text-muted text-xs mb-1">Best Ask</p>
          <p className="text-neg font-mono text-base font-semibold">{fmt(data.bestAsk)}</p>
        </div>
        <div className="bg-raised border border-line rounded p-2.5">
          <p className="text-muted text-xs mb-1">Mid Price</p>
          <p className="text-ink font-mono text-sm">{fmt(data.midPrice)}</p>
        </div>
        <div className="bg-raised border border-line rounded p-2.5">
          <p className="text-muted text-xs mb-1">Spread</p>
          <p className="text-accent font-mono text-sm">{fmtBps(data.spreadBps)}</p>
        </div>
      </div>

      {/* Imbalance bar */}
      {data.imbalanceRatio !== null && (
        <div>
          <div className="flex justify-between text-xs text-muted mb-1">
            <span>Buy Pressure</span>
            <span>Sell Pressure</span>
          </div>
          <div className="h-1 bg-line rounded-full overflow-hidden">
            <div
              className="h-full bg-cyan/70 rounded-full transition-all duration-300"
              style={{ width: `${Math.max(0, Math.min(100, ((data.imbalanceRatio + 1) / 2) * 100))}%` }}
            />
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-line">
        {data.regime ? (
          <span className={`text-xs font-mono px-2 py-0.5 rounded border ${regimeBadge[data.regime] ?? regimeBadge.NORMAL}`}>
            {data.regime} volatility
          </span>
        ) : (
          <span className="text-muted text-xs">—</span>
        )}
        <span className={`text-xs font-mono ${freshness.color}`}>
          ⏱ {freshness.text}
        </span>
      </div>
    </div>
  );
}
