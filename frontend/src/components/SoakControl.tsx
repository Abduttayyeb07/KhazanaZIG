"use client";

import { useState } from "react";
import type { DashboardSoak } from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// START and STOP stay two separate controls rather than one toggle: they are not
// symmetric actions (start commits simulated capital, stop unwinds the run and
// returns the engine to READ_ONLY), and a button that changes meaning is the one
// you mis-press while watching a number move. Each is disabled when it would be a
// no-op, so the control state always reflects what the engine is doing.
export function SoakControl({ soak, operatorToken, onToken }: {
  soak: DashboardSoak;
  operatorToken: string;
  onToken: (t: string) => void;
}) {
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(action: "start" | "stop") {
    if (!operatorToken) return setError("Operator token required.");
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/operator/soak/${action}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-operator-token": operatorToken },
        body: "{}",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          res.status === 401 ? "Token rejected."
          : res.status === 429 ? "Rate limited."
          : (data.error as string) ?? `Failed (${res.status})`
        );
      }
    } catch {
      setError("Engine unreachable.");
    } finally {
      setBusy(null);
    }
  }

  const running = soak.running;
  const elapsed = soak.startedAt ? Date.now() - soak.startedAt : null;

  return (
    <div className="control-bar flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2 min-w-[130px]">
        <span className={`w-1.5 h-1.5 rounded-full ${running ? "bg-pos animate-pulse-slow" : "bg-muted"}`} />
        <div className="leading-tight">
          <p className={`text-xs font-semibold ${running ? "text-pos" : "text-secondary"}`}>
            {running ? "Simulation running" : "Simulation paused"}
          </p>
          <p className="text-2xs text-muted font-mono">
            {running && elapsed ? formatElapsed(elapsed) : "Ready when you are"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => call("start")}
          disabled={running || busy !== null}
          className="rounded-md px-4 py-2 text-xs font-semibold text-canvas bg-accent
                     transition-colors hover:bg-accent-soft active:bg-accent
                     disabled:bg-line disabled:text-muted disabled:cursor-not-allowed"
        >
          {busy === "start" ? "Starting…" : "Start simulation"}
        </button>

        <button
          onClick={() => call("stop")}
          disabled={!running || busy !== null}
          className="rounded-md px-4 py-2 text-xs font-semibold border border-neg/40 text-neg bg-neg/[0.07]
                     transition-colors hover:bg-neg/15
                     disabled:border-line disabled:bg-transparent disabled:text-muted disabled:cursor-not-allowed"
        >
          {busy === "stop" ? "Stopping…" : "Stop"}
        </button>
      </div>

      {/* Gates every control route. Held in memory only — never persisted, since
          it authorises execution. */}
      <input
        type="password"
        value={operatorToken}
        onChange={(e) => onToken(e.target.value)}
        placeholder="Operator token"
        aria-label="Operator token"
        className="field py-1.5 text-xs flex-1 min-w-[150px] max-w-xs"
      />

      <span className="chip border-accent/30 bg-accent/10 text-accent-soft">Paper</span>

      {error && <span role="alert" className="text-2xs text-neg">{error}</span>}
    </div>
  );
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
