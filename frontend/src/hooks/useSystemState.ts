"use client";

import { useEffect, useRef, useState } from "react";
import type { DashboardState } from "@/types";

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001/ws";

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

      const ws = new WebSocket(WS_URL);
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
