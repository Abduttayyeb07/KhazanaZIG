import type { MarketZone, ZoneDecision } from "./zone-types.js";

export interface ZoneChangeEvent {
  previous: MarketZone | null;
  current: ZoneDecision;
  at: number;
}

export type ZoneChangeHandler = (e: ZoneChangeEvent) => void;
