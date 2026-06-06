import type { VolatilityRegime } from "@zig/shared-types";
import type { RiskConfig, RiskContext } from "../risk-types.js";

export interface VolatilityInputs {
  return15mPct?: number;
  atr15mPct?: number;
  spreadBps: number;
  normalSpreadBps?: number;
  liquidityDropPct?: number;
  exchangeHealthy: boolean;
  reconciliationHealthy: boolean;
  fallbackRegime?: VolatilityRegime;
}

export function classifyVolatility(inputs: VolatilityInputs, cfg: RiskConfig): VolatilityRegime {
  if (!inputs.exchangeHealthy || !inputs.reconciliationHealthy) return "CHAOTIC";
  if (inputs.spreadBps >= cfg.maxSpreadBps) return "CHAOTIC";
  if (inputs.normalSpreadBps && inputs.spreadBps >= inputs.normalSpreadBps * cfg.chaoticSpreadMultiplier) return "CHAOTIC";
  if (inputs.liquidityDropPct !== undefined && inputs.liquidityDropPct >= 0.5) return "CHAOTIC";
  if (inputs.return15mPct !== undefined && Math.abs(inputs.return15mPct) >= cfg.max15mMovePct) return "CHAOTIC";
  if (inputs.atr15mPct !== undefined) {
    if (inputs.atr15mPct >= cfg.highVolAtrPct) return "CHAOTIC";
    if (inputs.atr15mPct >= cfg.normalVolAtrPct) return "HIGH";
    if (inputs.atr15mPct >= cfg.lowVolAtrPct) return "NORMAL";
    return "LOW";
  }
  return inputs.fallbackRegime ?? "NORMAL";
}

export function classifyContextVolatility(ctx: RiskContext, cfg: RiskConfig): VolatilityRegime {
  return classifyVolatility(
    {
      spreadBps: ctx.marketState?.spreadBps ?? Number.POSITIVE_INFINITY,
      exchangeHealthy:
        ctx.exchangeHealth.websocketHealthy &&
        ctx.exchangeHealth.sequenceHealthy &&
        !ctx.exchangeHealth.stale &&
        ctx.exchangeHealth.reconnectsLast5m <= cfg.maxReconnectsPer5m,
      reconciliationHealthy: ctx.reconciliationStatus === cfg.reconciliationRequiredStatus || ctx.mode === "PAPER_MODE",
      fallbackRegime: ctx.marketState?.volatilityRegime,
    },
    cfg
  );
}
