import type { ReactNode } from "react";

type Tone = "neutral" | "pos" | "neg" | "accent" | "warn";

const TONE: Record<Tone, string> = {
  neutral: "text-ink",
  pos: "text-pos",
  neg: "text-neg",
  accent: "text-accent-soft",
  warn: "text-warn",
};

// A single figure with its label. Compact by design: these sit in a row of four
// and the row should read as one instrument cluster, not four separate boxes.
export function StatCard({
  label, value, sub, tone = "neutral", hint,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  hint?: string;
}) {
  return (
    <div className="stat-item" title={hint}>
      <p className="label">{label}</p>
      <p className={`metric text-base mt-1 leading-none ${TONE[tone]}`}>{value}</p>
      {sub != null && <p className="text-2xs text-muted mt-1 leading-tight truncate">{sub}</p>}
    </div>
  );
}

export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

export function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(6);
}

export function fmtSigned(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${fmtNum(n, digits)}`;
}
