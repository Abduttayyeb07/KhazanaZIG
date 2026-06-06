// ── Sliding-window rate limiter ────────────────────────────────────────────────
//
// In-memory, per-key (ip + route) request counting. Protects control routes from
// accidental loops, refresh spam, and compromised local scripts. Not a defense
// against distributed attacks (that's the proxy/firewall's job) — it's a sane
// internal guardrail.
// ──────────────────────────────────────────────────────────────────────────────

interface Window {
  timestamps: number[];
}

export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  // Returns true if the request is allowed, false if rate-limited.
  check(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let win = this.windows.get(key);
    if (!win) {
      win = { timestamps: [] };
      this.windows.set(key, win);
    }

    // Drop timestamps outside the window
    win.timestamps = win.timestamps.filter((t) => t > cutoff);

    if (win.timestamps.length >= this.maxRequests) return false;

    win.timestamps.push(now);
    return true;
  }

  // Periodic cleanup to bound memory (call occasionally).
  prune(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, win] of this.windows.entries()) {
      win.timestamps = win.timestamps.filter((t) => t > cutoff);
      if (win.timestamps.length === 0) this.windows.delete(key);
    }
  }
}
