"use client";

import { useSystemState } from "@/hooks/useSystemState";
import { SystemHeader } from "@/components/SystemHeader";
import { ExchangeCard } from "@/components/ExchangeCard";
import { EventLog } from "@/components/EventLog";
import { SessionPanel } from "@/components/SessionPanel";
import { TreasuryPanel } from "@/components/TreasuryPanel";
import { ExecutionPanel } from "@/components/ExecutionPanel";
import { AccountStatePanel } from "@/components/AccountStatePanel";

export default function Dashboard() {
  const { state, status } = useSystemState();

  return (
    <div className="min-h-screen flex flex-col bg-surface">
      <SystemHeader state={state} wsStatus={status} />

      <main className="flex-1 p-6 flex flex-col gap-6 max-w-6xl mx-auto w-full">

        {/* No data yet */}
        {!state && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-600">
            <div className="w-6 h-6 rounded-full border-2 border-zinc-700 border-t-violet-500 animate-spin" />
            <p className="font-mono text-sm">
              {status === "connecting" ? "Connecting to engine..." : "Engine offline — waiting for reconnect"}
            </p>
          </div>
        )}

        {state && (
          <>
            {/* Trading session — encrypted key management */}
            <SessionPanel />

            {/* Treasury accounting — inventory, cost basis, harvested PnL */}
            <TreasuryPanel treasury={state.treasury} />

            {/* Execution — place limit orders (paper-mode), manage open orders */}
            <ExecutionPanel orders={state.execution.managedOrders} mode={state.mode} symbol={state.symbol} />

            {/* Exchange cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ExchangeCard name="BYBIT" data={state.exchanges.bybit} />
              <ExchangeCard name="MEXC" data={state.exchanges.mexc} />
            </div>

            <AccountStatePanel account={state.account} />

            {/* Summary row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                {
                  label: "Bybit Mid",
                  value: state.exchanges.bybit.midPrice?.toFixed(6) ?? "—",
                  sub: "ZIGUSDT",
                },
                {
                  label: "MEXC Mid",
                  value: state.exchanges.mexc.midPrice?.toFixed(6) ?? "—",
                  sub: "ZIGUSDT",
                },
                {
                  label: "Bybit Spread",
                  value: state.exchanges.bybit.spreadBps != null
                    ? state.exchanges.bybit.spreadBps.toFixed(2) + " bps"
                    : "—",
                  sub: state.exchanges.bybit.regime ?? "",
                },
                {
                  label: "MEXC Spread",
                  value: state.exchanges.mexc.spreadBps != null
                    ? state.exchanges.mexc.spreadBps.toFixed(2) + " bps"
                    : "—",
                  sub: state.exchanges.mexc.regime ?? "",
                },
              ].map((item) => (
                <div key={item.label} className="bg-card border border-border rounded-xl p-4">
                  <p className="text-zinc-500 text-xs mb-1">{item.label}</p>
                  <p className="text-white font-mono text-base font-semibold">{item.value}</p>
                  {item.sub && <p className="text-zinc-600 text-xs mt-0.5">{item.sub}</p>}
                </div>
              ))}
            </div>

            {/* Event log */}
            <EventLog events={state.events} />

            {/* Footer */}
            <div className="text-center text-zinc-700 text-xs font-mono">
              Last update: {new Date(state.updatedAt).toLocaleTimeString("en-US", { hour12: false })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
