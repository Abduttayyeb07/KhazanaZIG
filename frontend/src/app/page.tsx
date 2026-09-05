"use client";

import { useEffect, useRef, useState } from "react";
import { useSystemState } from "@/hooks/useSystemState";
import { SystemHeader } from "@/components/SystemHeader";
import { SignInPage } from "@/components/SignInPage";
import { SoakControl } from "@/components/SoakControl";
import { PriceChart, type PricePoint } from "@/components/PriceChart";
import { ZonePanel, HarvestPanel, AccumulationPanel, FillsPanel, BlockedPanel } from "@/components/ActivityPanels";
import { StatCard, fmtCompact, fmtNum, fmtPrice, fmtSigned } from "@/components/StatCard";
import { EventLog } from "@/components/EventLog";
import { ExchangeCard } from "@/components/ExchangeCard";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const MAX_POINTS = 600; // ~ the last few hours at a 30s tick

export default function Dashboard() {
  const [auth, setAuth] = useState<{ checked: boolean; email: string | null }>({ checked: false, email: null });
  const [view, setView] = useState<"overview" | "activity" | "system">("overview");
  const [operatorToken, setOperatorToken] = useState("");
  const { state, status } = useSystemState(Boolean(auth.email));

  // Price history is accumulated client-side: the engine broadcasts current state,
  // not a series. Kept in a ref so appending a point doesn't re-render the tree,
  // with a counter to trigger the redraw.
  const historyRef = useRef<PricePoint[]>([]);
  const [, setTick] = useState(0);

  const mark = state?.soak.markPrice ?? state?.exchanges.mexc.midPrice ?? null;

  useEffect(() => {
    if (mark == null || !Number.isFinite(mark)) return;
    const h = historyRef.current;
    const last = h[h.length - 1];
    // Only record genuine movement or a new second — otherwise a burst of
    // identical broadcasts flattens the visible window.
    if (!last || last.price !== mark || Date.now() - last.t > 1_000) {
      h.push({ t: Date.now(), price: mark });
      if (h.length > MAX_POINTS) h.splice(0, h.length - MAX_POINTS);
      setTick((n) => n + 1);
    }
  }, [mark, state?.updatedAt]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/auth/me`, { credentials: "include" })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) return setAuth({ checked: true, email: null });
        const data = await res.json();
        setAuth({ checked: true, email: data.email ?? null });
      })
      .catch(() => { if (!cancelled) setAuth({ checked: true, email: null }); });
    return () => { cancelled = true; };
  }, []);

  async function logout() {
    await fetch(`${API_BASE}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined);
    setOperatorToken("");
    historyRef.current = [];
    setAuth({ checked: true, email: null });
  }

  if (!auth.checked) {
    return (
      <div className="min-h-screen flex items-center justify-center gap-3 text-muted">
        <div className="w-4 h-4 rounded-full border-2 border-line border-t-accent animate-spin" />
        <span className="text-sm">Checking session…</span>
      </div>
    );
  }

  if (!auth.email) return <SignInPage onSignedIn={(email) => setAuth({ checked: true, email })} />;

  const soak = state?.soak;

  return (
    <div className="min-h-screen flex flex-col">
      <SystemHeader state={state} wsStatus={status} email={auth.email} onLogout={logout} />

      <main className="dashboard-main">
        <div className="page-heading">
          <div><p className="eyebrow">YOUR TREASURY, IN PERSPECTIVE</p><h1>Treasury overview<span>.</span></h1><p>Follow your capital. Understand every move.</p></div>
          <div className="workspace-label"><span className="workspace-icon">Z</span><div><strong>ZIG / USDT</strong><span>MEXC / Treasury strategy</span></div></div>
        </div>
        <nav className="view-tabs" aria-label="Dashboard views">
          {(["overview", "activity", "system"] as const).map((tab) => <button key={tab} aria-current={view === tab ? "page" : undefined} className={view === tab ? "active" : ""} onClick={() => setView(tab)}>{tab === "overview" ? "Overview" : tab === "activity" ? "Trading activity" : "System & events"}{tab === "activity" && state ? <span>{state.soak.recentFills.length}</span> : null}</button>)}
        </nav>
        {!state && (
          <div className="card py-20 flex flex-col items-center justify-center gap-3 text-muted">
            <div className="w-6 h-6 rounded-full border-2 border-line border-t-accent animate-spin" />
            <p className="text-xs">
              {status === "connecting" ? "Connecting to the engine…" : "Engine offline — retrying"}
            </p>
            {status === "disconnected" && (
              <p className="text-2xs text-muted">Market data will resume when the engine reconnects.</p>
            )}
          </div>
        )}

        {state && soak && (
          <>
            <SoakControl soak={soak} operatorToken={operatorToken} onToken={setOperatorToken} />

            {view === "overview" && <>
            <div className="portfolio-strip">
                <StatCard
                  label="Portfolio value"
                  tone="neutral"
                  value={soak.nav != null ? fmtNum(soak.nav) : "—"}
                  sub={soak.navDelta != null ? `${fmtSigned(soak.navDelta)} USDT since start` : "USDT / Available when simulation starts"}
                  hint="ZIG holdings valued at the current market price, plus available USDT"
                />
                <StatCard
                  label="Realized harvest"
                  tone="accent"
                  value={fmtNum(soak.harvest.harvestedUsdt)}
                  sub="USDT from closed cycles"
                  hint="Only completed sell→rebuy round-trips count"
                />
                <StatCard
                  label="ZIG holdings"
                  value={fmtCompact(soak.zig)}
                  sub={`${fmtCompact(soak.activeZig)} active · ${fmtCompact(soak.reserveZig)} reserve`}
                />
                <StatCard
                  label="Available USDT"
                  value={fmtNum(soak.usdt)}
                  sub={`avg cost ${fmtPrice(soak.avgCost)}`}
                />
            </div>

            <div className="market-layout">
              <PriceChart points={historyRef.current} mark={mark} zones={state.zones} />
              <aside className="strategy-sidebar"><div className="section-kicker">STRATEGY AT A GLANCE</div><ZonePanel soak={soak} /><HarvestPanel soak={soak} /></aside>
            </div>
            <div className="overview-bottom"><ExchangeCard name="MEXC" data={state.exchanges.mexc} /><AccumulationPanel soak={soak} /></div>
            </>}
            {view === "activity" && <div className="activity-layout"><FillsPanel soak={soak} /><BlockedPanel soak={soak} /></div>}
            {view === "system" && <div className="system-layout"><ExchangeCard name="MEXC" data={state.exchanges.mexc} /><EventLog events={state.events} /></div>}

            <p className="dashboard-footer">
              Simulation only — no real orders, no exchange credentials. Updated{" "}
              {new Date(state.updatedAt).toLocaleTimeString("en-US", { hour12: false })}
            </p>
          </>
        )}
      </main>
    </div>
  );
}
