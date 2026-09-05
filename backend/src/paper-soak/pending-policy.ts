import type { ManagedOrder } from "@zig/shared-types";
import type { AllowedActions } from "../zone-manager/zone-types.js";
import type { VirtualAccount } from "./virtual-account.js";
import type { AccumulationEngine } from "../accumulation/accumulation-engine.js";

export function pendingAllowed(order: ManagedOrder, allowed: AllowedActions, account: VirtualAccount, acc: AccumulationEngine | null, maxAgeMs: number): boolean {
  if (Date.now() - order.createdAt > maxAgeMs) return false;
  const remaining = order.quantity - order.filledQuantity;
  switch (order.reason) {
    case "harvest-sell":
      return allowed.harvestSell && remaining <= account.activeZig - (acc ? acc.heldZig() - acc.metrics().surplusZig : 0) + 1e-7;
    case "harvest-rebuy": {
      const eligible = account.openCyclesForRebuy(order.price).filter(c => order.cycleIds?.includes(c.cycleId));
      return allowed.harvestRebuy && remaining <= eligible.reduce((n, c) => n + c.unrecoveredQty, 0) + 1e-7;
    }
    case "acc-buy": return allowed.accumulationBuy;
    case "acc-recovery": {
      const eligible = acc?.tracker.openForRecovery(order.price).filter(c => order.cycleIds?.includes(c.cycleId)) ?? [];
      return allowed.accumulationRecoverySell && remaining <= eligible.reduce((n, c) => n + c.boughtQty - c.recoveredSellQty, 0) + 1e-7;
    }
    default: return false;
  }
}
