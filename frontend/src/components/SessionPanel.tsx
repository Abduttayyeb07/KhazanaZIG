"use client";

import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";

interface SessionStatus {
  active: boolean;
  exchanges: string[];
  startedAt: number | null;
  ephemeralEncryption: boolean;
}

type ExchangeChoice = "bybit" | "mexc";

export function SessionPanel() {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [exchange, setExchange] = useState<ExchangeChoice>("bybit");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [operatorToken, setOperatorToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [removing, setRemoving] = useState<ExchangeChoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem("zig_operator_token");
    if (saved) setOperatorToken(saved);
  }, []);

  async function loadStatus() {
    try {
      const res = await fetch(`${API_BASE}/api/public/session-status`);
      setStatus(await res.json());
    } catch {
      setStatus(null);
    }
  }

  useEffect(() => {
    loadStatus();
    const t = setInterval(loadStatus, 5_000);
    return () => clearInterval(t);
  }, []);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      sessionStorage.setItem("zig_operator_token", operatorToken);
      const res = await fetch(`${API_BASE}/api/operator/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-operator-token": operatorToken },
        body: JSON.stringify({ exchange, apiKey, apiSecret }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Submission failed");
      }
      setApiKey("");
      setApiSecret("");
      setOpen(false);
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeKeys(exchangeToRemove: ExchangeChoice) {
    if (!operatorToken) {
      setError("Operator token is required to remove keys");
      return;
    }

    setRemoving(exchangeToRemove);
    setError(null);
    try {
      sessionStorage.setItem("zig_operator_token", operatorToken);
      const res = await fetch(`${API_BASE}/api/operator/credentials`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "x-operator-token": operatorToken },
        body: JSON.stringify({ exchange: exchangeToRemove }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Removal failed");
      }
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Removal failed");
    } finally {
      setRemoving(null);
    }
  }

  const hasExchange = (ex: string) => status?.exchanges.includes(ex) ?? false;

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <span className="text-white font-semibold text-sm">Trading Session</span>
          <p className="text-zinc-500 text-xs mt-0.5">
            Exchange API keys encrypted at rest with AES-256-GCM
          </p>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-mono px-3 py-1.5 rounded-md bg-violet-600/20 text-violet-300 border border-violet-700 hover:bg-violet-600/30 transition-colors"
        >
          {open ? "Cancel" : "+ Add Keys"}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
        {(["bybit", "mexc"] as const).map((ex) => (
          <div key={ex} className="bg-surface rounded-lg p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-zinc-300 text-xs font-mono uppercase">{ex}</span>
              <span className={`block text-xs font-mono mt-1 ${hasExchange(ex) ? "text-emerald-400" : "text-zinc-600"}`}>
                {hasExchange(ex) ? "keyed" : "none"}
              </span>
            </div>
            {hasExchange(ex) && (
              <button
                onClick={() => removeKeys(ex)}
                disabled={removing !== null}
                className="shrink-0 text-xs font-mono px-2.5 py-1.5 rounded-md bg-red-950/50 text-red-300 border border-red-900 hover:bg-red-900/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {removing === ex ? "Removing" : "Remove"}
              </button>
            )}
          </div>
        ))}
      </div>

      {!open && (
        <div className="mt-3 flex flex-col gap-2">
          <input
            type="password"
            placeholder="Operator Token (required to remove keys)"
            value={operatorToken}
            onChange={(e) => setOperatorToken(e.target.value)}
            className="bg-surface border border-amber-900/60 rounded-md px-3 py-2 text-sm text-amber-200 font-mono focus:outline-none focus:border-amber-600"
          />
          {error && <p className="text-red-400 text-xs">{error}</p>}
        </div>
      )}

      {status?.ephemeralEncryption && (
        <p className="text-yellow-500/80 text-xs mt-2">
          Ephemeral encryption key: set ENCRYPTION_KEY for persistence across restarts
        </p>
      )}

      {open && (
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex gap-2">
            {(["bybit", "mexc"] as const).map((ex) => (
              <button
                key={ex}
                onClick={() => setExchange(ex)}
                className={`flex-1 text-xs font-mono py-1.5 rounded-md border transition-colors ${
                  exchange === ex
                    ? "bg-violet-600/30 text-violet-200 border-violet-600"
                    : "bg-surface text-zinc-500 border-border"
                }`}
              >
                {ex.toUpperCase()}
              </button>
            ))}
          </div>
          <input
            type="password"
            placeholder="API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="bg-surface border border-border rounded-md px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-violet-600"
          />
          <input
            type="password"
            placeholder="API Secret"
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            className="bg-surface border border-border rounded-md px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-violet-600"
          />
          <input
            type="password"
            placeholder="Operator Token (control-plane auth)"
            value={operatorToken}
            onChange={(e) => setOperatorToken(e.target.value)}
            className="bg-surface border border-amber-900/60 rounded-md px-3 py-2 text-sm text-amber-200 font-mono focus:outline-none focus:border-amber-600"
          />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button
            onClick={submit}
            disabled={submitting || !apiKey || !apiSecret || !operatorToken}
            className="text-xs font-mono py-2 rounded-md bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Encrypting & storing..." : `Submit ${exchange.toUpperCase()} keys`}
          </button>
          <p className="text-zinc-600 text-xs">
            Keys are sent over HTTPS, encrypted server-side, and never logged or returned.
          </p>
        </div>
      )}
    </div>
  );
}
