"use client";

import { useEffect, useRef, useState } from "react";
import type { DashboardState } from "@/types";

// NEXT_PUBLIC_WS_URL is inlined at build time as an empty string (not undefined)
// when unset - Docker passes `ARG NEXT_PUBLIC_WS_URL=""` by default - so a `??`
// fallback here never fires and `new WebSocket("")` resolves against the current
// PAGE's own URL (root path, not /ws). Unlike API_BASE elsewhere in this app,
// which is used as a *prefix* before a path that already starts with "/" (so an
// empty string harmlessly disappears), the WebSocket URL has no path appended -
// it needs a real same-origin default computed at connect time, in the browser.
function resolveWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws`;
  }
  return "ws://localhost:3001/ws";
}

type ConnectionStatus = "connecting" | "connected" | "disconnected";

export function useSystemState(enabled = true) {
  const [state, setState] = useState<DashboardState | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      wsRef.current?.close();
      setState(null);
      setStatus("disconnected");
      return;
    }

    let destroyed = false;

    function connect() {
      if (destroyed) return;
      setStatus("connecting");

      const ws = new WebSocket(resolveWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (!destroyed) setStatus("connected");
      };

      ws.onmessage = (e: MessageEvent<string>) => {
        try {
          const msg = JSON.parse(e.data) as { type: string; data: DashboardState };
          if (msg.type === "STATE_UPDATE") setState(msg.data);
        } catch {
          // malformed message — ignore
        }
      };

      ws.onclose = () => {
        if (destroyed) return;
        setStatus("disconnected");
        timerRef.current = setTimeout(connect, 2_000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [enabled]);

  return { state, status };
}
