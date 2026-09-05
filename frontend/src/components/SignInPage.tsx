"use client";

import { useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// ── Sign in ─────────────────────────────────────────────────────────────────────
//
// Deliberately NOT a signup page. Accounts are created from the terminal
// (`npm run add-user -- <email> <password>`) because this login guards a control
// plane that can move treasury inventory — self-service registration would be a
// way in, not a convenience.
// ──────────────────────────────────────────────────────────────────────────────

export function SignInPage({ onSignedIn }: { onSignedIn: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 503 means the engine is up but has no database — a materially different
        // problem from a wrong password, so say so rather than "invalid login".
        setError(
          res.status === 503
            ? "Authentication unavailable — the engine has no database connection."
            : (data.error as string) ?? "Sign in failed"
        );
        return;
      }
      onSignedIn((data.email as string) ?? email);
    } catch {
      setError("Cannot reach the engine. Please try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-[880px] grid md:grid-cols-[1.05fr_1fr] gap-0 card overflow-hidden">
        {/* Identity side */}
        <div className="hidden md:flex flex-col justify-between p-10 border-r border-line bg-raised">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded bg-accent flex items-center justify-center">
                <span className="text-canvas font-bold text-xs">Z</span>
              </div>
              <div>
                <p className="text-ink font-semibold text-sm tracking-tight leading-none">ZIG Khazana</p>
                <p className="label mt-1">Treasury Console</p>
              </div>
            </div>

            <p className="mt-7 text-xs leading-relaxed text-secondary">
              Volatility harvesting over a protected treasury. Sell strength, rebuy weakness,
              and never touch the reserve.
            </p>
          </div>

          <div className="space-y-3">
            {[
              ["Simulation only", "Every order is simulated. No real funds, no exchange keys."],
              ["Operator controlled", "Nothing runs until you press Start."],
              ["Reserve protected", "The reserve floor is never sold into."],
            ].map(([title, body]) => (
              <div key={title} className="flex gap-3">
                <div className="mt-1.5 w-1 h-1 rounded-full bg-accent shrink-0" />
                <div>
                  <p className="text-2xs font-semibold text-secondary">{title}</p>
                  <p className="text-2xs text-muted leading-snug">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Form side */}
        <div className="p-10">
          <div className="md:hidden flex items-center gap-2.5 mb-8">
            <div className="w-7 h-7 rounded bg-accent flex items-center justify-center">
              <span className="text-canvas font-bold text-xs">Z</span>
            </div>
            <p className="text-ink font-semibold text-sm">ZIG Khazana</p>
          </div>

          <h1 className="text-xl font-semibold text-ink tracking-tight">Sign in</h1>
          <p className="text-sm text-muted mt-1.5 mb-7">Operator access to the treasury console.</p>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="email" className="label block mb-2">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="field"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="label block mb-2">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="field"
                placeholder="••••••••••••"
              />
            </div>

            {error && (
              <p role="alert" className="text-xs text-neg bg-neg/10 border border-neg/25 rounded-lg px-3 py-2.5 leading-relaxed">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md py-2.5 text-sm font-semibold text-canvas bg-accent
                         transition-colors hover:bg-accent-soft
                         disabled:bg-line disabled:text-muted disabled:cursor-not-allowed"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="mt-6 text-2xs text-muted leading-relaxed border-t border-line pt-4">Private workspace. Contact your administrator for operator access.</p>
        </div>
      </div>
    </div>
  );
}
