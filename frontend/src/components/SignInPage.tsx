"use client";

import { FormEvent, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface SignInPageProps {
  onSignedIn: (email: string) => void;
}

export function SignInPage({ onSignedIn }: SignInPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Sign in failed");
        return;
      }
      onSignedIn(data.email ?? email);
    } catch {
      setError("Engine unavailable");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-surface flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm border border-border bg-card rounded-lg p-6">
        <div className="mb-6">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">ZIG Khazana</p>
          <h1 className="text-xl font-semibold text-white mt-1">Sign in</h1>
        </div>

        <label className="block text-xs text-zinc-500 mb-2" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
        />

        <label className="block text-xs text-zinc-500 mt-4 mb-2" htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
        />

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white rounded-md py-2 text-sm font-semibold"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}
