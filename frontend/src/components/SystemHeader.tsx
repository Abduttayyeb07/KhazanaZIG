"use client";
import type { DashboardState } from "@/types";
export function SystemHeader({ state, wsStatus, email, onLogout }: {
  state: DashboardState | null;
  wsStatus: "connecting" | "connected" | "disconnected";
  email: string;
  onLogout: () => void;
}) {
  return <header className="site-header">
    <a className="brand" href="/" aria-label="Khazana home"><span className="brand-mark">K<span /></span><span>khazana<span className="brand-caption">ZIG TREASURY</span></span></a>
    <div className="header-context">Treasury workspace <span>/</span> <strong>Overview</strong></div>
    <div className="header-account">
      <span className="connection"><i className={wsStatus} />{wsStatus === "connected" ? "Engine connected" : wsStatus}</span>
      <span className="mode-badge">{state?.mode.replaceAll("_", " ") ?? "Awaiting engine"}</span>
      <span className="avatar" title={email}>{email[0].toUpperCase()}</span>
      <button className="signout" onClick={onLogout}>Sign out</button>
    </div>
  </header>;
}
