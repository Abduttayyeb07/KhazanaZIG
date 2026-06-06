"use client";

import type { DashboardEvent } from "@/types";

interface Props {
  events: DashboardEvent[];
}

const levelStyle: Record<DashboardEvent["level"], string> = {
  info: "text-zinc-400",
  warn: "text-yellow-400",
  error: "text-red-400",
};

const levelTag: Record<DashboardEvent["level"], string> = {
  info: "text-zinc-600",
  warn: "text-yellow-600",
  error: "text-red-600",
};

function formatTime(iso: string): string {
  // Use UTC to avoid server/client locale hydration mismatch
  const d = new Date(iso);
  return [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

export function EventLog({ events }: Props) {
  return (
    <div className="bg-card border border-border rounded-xl flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <span className="text-zinc-400 text-sm font-medium">Event Log</span>
        <span className="text-zinc-600 text-xs font-mono">{events.length} events</span>
      </div>
      <div className="overflow-y-auto max-h-72 flex flex-col-reverse">
        {events.length === 0 ? (
          <p className="text-zinc-600 text-xs font-mono p-4">Waiting for events...</p>
        ) : (
          <div className="divide-y divide-border">
            {events.map((ev, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-2 hover:bg-surface/50 transition-colors">
                <span className="text-zinc-600 font-mono text-xs mt-0.5 shrink-0">{formatTime(ev.time)}</span>
                <span className={`font-mono text-xs shrink-0 uppercase ${levelTag[ev.level]}`}>[{ev.level}]</span>
                <span className={`font-mono text-xs ${levelStyle[ev.level]}`}>{ev.msg}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
