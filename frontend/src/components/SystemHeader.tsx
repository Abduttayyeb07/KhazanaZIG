"use client";

import { useEffect, useState } from "react";
import type { DashboardState } from "@/types";

interface Props {
  state: DashboardState | null;
  wsStatus: "connecting" | "connected" | "disconnected";
}

const modeColor: Record<string, string> = {
  READ_ONLY: "bg-blue-900/40 text-blue-300 border-blue-800",
  PAPER_MODE: "bg-violet-900/40 text-violet-300 border-violet-800",
  NORMAL: "bg-emerald-900/40 text-emerald-300 border-emerald-800",
  DEFENSIVE: "bg-yellow-900/40 text-yellow-300 border-yellow-800",
  HALT: "bg-red-900/40 text-red-300 border-red-800",
};

function calcUptime(startedAt: number): string {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

export function SystemHeader({ state, wsStatus }: Props) {
  // Computed only on client to avoid server/client hydration mismatch
  const [uptime, setUptime] = useState("--:--:--");

  useEffect(() => {
    if (!state) return;
    setUptime(calcUptime(state.startedAt));
    const timer = setInterval(() => setUptime(calcUptime(state.startedAt)), 1_000);
    return () => clearInterval(timer);
  }, [state?.startedAt]);

  return (
    <div className="border-b border-border px-6 py-4 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div>
          <span className="text-white font-bold text-xl tracking-tight">ZIG Khazana</span>
          <span className="text-zinc-500 text-sm ml-2">Core Engine</span>
        </div>
        {state && (
          <span className={`text-xs font-mono px-2.5 py-1 rounded-md border ${modeColor[state.mode] ?? modeColor.READ_ONLY}`}>
            {state.mode}
          </span>
        )}
      </div>

      <div className="flex items-center gap-5">
        {state && (
          <>
            <div className="text-right">
              <p className="text-zinc-500 text-xs">Symbol</p>
              <p className="text-white font-mono text-sm">{state.symbol}</p>
            </div>
            <div className="text-right">
              <p className="text-zinc-500 text-xs">Uptime</p>
              <p className="text-white font-mono text-sm">{uptime}</p>
            </div>
            <div className="text-right">
              <p className="text-zinc-500 text-xs">Session</p>
              <p className={`font-mono text-sm ${state.hasSession ? "text-emerald-400" : "text-zinc-500"}`}>
                {state.hasSession ? "Active" : "None"}
              </p>
            </div>
          </>
        )}

        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${
            wsStatus === "connected" ? "bg-emerald-400 animate-pulse" :
            wsStatus === "connecting" ? "bg-yellow-400 animate-pulse" :
            "bg-red-500"
          }`} />
          <span className="text-zinc-500 text-xs font-mono">
            {wsStatus === "connected" ? "LIVE" : wsStatus === "connecting" ? "CONNECTING" : "OFFLINE"}
          </span>
        </div>
      </div>
    </div>
  );
}
