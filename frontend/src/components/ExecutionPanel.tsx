"use client";

import { useState } from "react";
import type { DashboardManagedOrder } from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";

interface Props {
  orders: DashboardManagedOrder[];
  mode: string;
  symbol: string;
}

const statusColor: Record<string, string> = {
  CREATED: "text-zinc-400",
  SUBMITTED: "text-blue-300",
  OPEN: "text-blue-400",
  PARTIALLY_FILLED: "text-yellow-300",
  FILLED: "text-emerald-400",
  CANCEL_PENDING: "text-orange-300",
  CANCELLED: "text-zinc-500",
  REJECTED: "text-red-400",
  FAILED: "text-red-500",
};

export function ExecutionPanel({ orders, mode, symbol }: Props) {
  const [exchange, setExchange] = useState<"bybit" | "mexc">("bybit");
  const [side, setSide] = useState<"buy" | "sell">("sell");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (typeof window !== "undefined" && !token) {
    const saved = sessionStorage.getItem("zig_operator_token");
    if (saved) setToken(saved);
  }

  const canTrade = mode === "PAPER_MODE" || mode === "NORMAL" || mode === "DEFENSIVE";

  async function place() {
    setBusy(true);
    setMsg(null);
    try {
      sessionStorage.setItem("zig_operator_token", token);
      const res = await fetch(`${API_BASE}/api/operator/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-operator-token": token },
        body: JSON.stringify({ exchange, side, price: Number(price), quantity: Number(quantity) }),
      });
      const data = (await res.json()) as {
        error?: string;
        stage?: string;
        clientOrderId?: string;
        status?: string;
        risk?: { decision: string; requestedQty: number; approvedQty: number; reasons: string[] };
      };
      if (!res.ok) throw new Error(`${data.error}${data.stage ? ` [${data.stage}]` : ""}`);
      const riskText = data.risk && data.risk.decision !== "ALLOW"
        ? ` / ${data.risk.decision}: ${data.risk.requestedQty} -> ${data.risk.approvedQty}`
        : "";
      setMsg({ ok: true, text: `Placed: ${data.clientOrderId} (${data.status})${riskText}` });
      setPrice(""); setQuantity("");
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Order failed" });
    } finally {
      setBusy(false);
    }
  }

  async function cancel(clientOrderId: string) {
    if (!token) {
      setMsg({ ok: false, text: "Enter the operator token to cancel" });
      return;
    }
    const res = await fetch(`${API_BASE}/api/operator/order`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "x-operator-token": token },
      body: JSON.stringify({ clientOrderId }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setMsg({ ok: false, text: data.error ?? "Cancel failed" });
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-white font-semibold text-sm">Execution</span>
          <p className="text-zinc-500 text-xs mt-0.5">
            {mode === "PAPER_MODE" ? "PAPER — simulated fills" : mode === "READ_ONLY" || mode === "HALT" ? `${mode} — trading disabled` : "LIVE — real orders"}
          </p>
        </div>
        <span className="text-zinc-600 text-xs font-mono">{orders.length} orders</span>
      </div>

      {/* Place order form */}
      <div className="flex flex-col gap-2 border-b border-border pb-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex gap-1">
            {(["bybit", "mexc"] as const).map((ex) => (
              <button key={ex} onClick={() => setExchange(ex)}
                className={`flex-1 text-xs font-mono py-1.5 rounded-md border ${exchange === ex ? "bg-violet-600/30 text-violet-200 border-violet-600" : "bg-surface text-zinc-500 border-border"}`}>
                {ex.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {(["buy", "sell"] as const).map((s) => (
              <button key={s} onClick={() => setSide(s)}
                className={`flex-1 text-xs font-mono py-1.5 rounded-md border ${side === s ? (s === "buy" ? "bg-emerald-600/30 text-emerald-200 border-emerald-600" : "bg-red-600/30 text-red-200 border-red-600") : "bg-surface text-zinc-500 border-border"}`}>
                {s.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Limit price" inputMode="decimal"
            className="bg-surface border border-border rounded-md px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-violet-600" />
          <input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder={`Qty (${symbol.replace("USDT", "")})`} inputMode="decimal"
            className="bg-surface border border-border rounded-md px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-violet-600" />
        </div>
        <input value={token} onChange={(e) => setToken(e.target.value)} type="password" placeholder="Operator token"
          className="bg-surface border border-amber-900/60 rounded-md px-3 py-2 text-sm text-amber-200 font-mono focus:outline-none focus:border-amber-600" />
        {msg && <p className={`text-xs ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p>}
        <button onClick={place} disabled={busy || !canTrade || !price || !quantity || !token}
          className={`text-xs font-mono py-2 rounded-md text-white disabled:opacity-40 disabled:cursor-not-allowed ${side === "buy" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-red-600 hover:bg-red-500"}`}>
          {busy ? "Submitting..." : !canTrade ? `${mode} — cannot place` : `${side.toUpperCase()} ${symbol}`}
        </button>
      </div>

      {/* Managed orders */}
      {orders.length === 0 ? (
        <p className="text-zinc-600 text-xs">No orders placed.</p>
      ) : (
        <div className="flex flex-col gap-1 max-h-56 overflow-y-auto">
          {orders.slice().reverse().map((o) => {
            const live = !["FILLED", "CANCELLED", "REJECTED", "FAILED"].includes(o.status);
            return (
              <div key={o.clientOrderId} className="flex items-center justify-between bg-surface rounded-md px-3 py-2">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`text-xs font-mono ${o.side === "buy" ? "text-emerald-400" : "text-red-400"}`}>{o.side.toUpperCase()}</span>
                  <span className="text-zinc-300 text-xs font-mono">{o.quantity}@{o.price}</span>
                  <span className="text-zinc-600 text-[10px] font-mono uppercase">{o.exchange}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-xs font-mono ${statusColor[o.status] ?? "text-zinc-400"}`}>{o.status}</span>
                  {live && (
                    <button onClick={() => cancel(o.clientOrderId)} className="text-[10px] text-zinc-500 hover:text-red-400 font-mono">cancel</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
