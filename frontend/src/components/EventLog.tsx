"use client";

import type { DashboardEvent } from "@/types";

interface Props {
  events: DashboardEvent[];
}

const levelStyle: Record<DashboardEvent["level"], string> = {
  info: "text-secondary",
  warn: "text-warn",
  error: "text-neg",
};

const levelTag: Record<DashboardEvent["level"], string> = {
  info: "text-muted",
  warn: "text-warn/70",
  error: "text-neg/70",
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
    <div className="card flex flex-col overflow-hidden">
      <div className="card-head">
        <h2 className="card-title">Events</h2>
        <span className="text-2xs text-muted">{events.length}</span>
      </div>
      <div className="overflow-y-auto max-h-52 flex flex-col-reverse">
        {events.length === 0 ? (
          <p className="text-muted text-2xs p-3.5">Waiting for events…</p>
        ) : (
          <div className="divide-y divide-line">
            {events.map((ev, i) => (
              <div key={i} className="flex items-start gap-2.5 px-3.5 py-1.5 hover:bg-raised transition-colors">
                <span className="text-muted font-mono text-2xs mt-px shrink-0">{formatTime(ev.time)}</span>
                <span className={`font-mono text-2xs shrink-0 uppercase ${levelTag[ev.level]}`}>[{ev.level}]</span>
                <span className={`font-mono text-2xs leading-snug line-clamp-2 ${levelStyle[ev.level]}`} title={ev.msg}>{ev.msg}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
