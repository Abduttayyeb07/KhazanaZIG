import type { Logger } from "@zig/logger";
import type { ExchangeBalance, ExchangeOrder, ExchangeFill } from "@zig/shared-types";
import type { AuthenticatedExchangeClient } from "../session/session-manager.js";
import type { BybitRestClient } from "../exchange/bybit/rest.js";
import type { MexcRestClient } from "../exchange/mexc/rest.js";

interface ExchangeRecovered {
  balances: ExchangeBalance[];
  openOrders: ExchangeOrder[];
  recentFills: ExchangeFill[];
}

export interface RecoveredState {
  bybit: ExchangeRecovered;
  mexc: ExchangeRecovered;
  recoveredAt: number;
}

const EMPTY: ExchangeRecovered = { balances: [], openOrders: [], recentFills: [] };

export class StateRecovery {
  private readonly client: AuthenticatedExchangeClient;
  private readonly symbol: string;
  private readonly log: Logger;

  constructor(client: AuthenticatedExchangeClient, symbol: string, log: Logger) {
    this.client = client;
    this.symbol = symbol;
    this.log = log.child({ module: "state-recovery" });
  }

  async recover(): Promise<RecoveredState> {
    this.log.info("Starting state recovery from exchange");

    const [bybit, mexc] = await Promise.all([
      this.recoverOne("bybit", this.client.bybit),
      this.recoverOne("mexc", this.client.mexc),
    ]);

    const state: RecoveredState = { bybit, mexc, recoveredAt: Date.now() };

    this.log.info(
      {
        bybitBalances: bybit.balances.length,
        bybitOrders: bybit.openOrders.length,
        bybitFills: bybit.recentFills.length,
        mexcBalances: mexc.balances.length,
        mexcOrders: mexc.openOrders.length,
        mexcFills: mexc.recentFills.length,
      },
      "State recovery complete"
    );

    return state;
  }

  private async recoverOne(
    label: string,
    client: BybitRestClient | MexcRestClient | null
  ): Promise<ExchangeRecovered> {
    if (!client) return { ...EMPTY };

    const [balances, openOrders, recentFills] = await Promise.all([
      client.getBalances().catch(this.onError(`${label}.balances`)),
      client.getOpenOrders(this.symbol).catch(this.onError(`${label}.openOrders`)),
      client.getRecentFills(this.symbol).catch(this.onError(`${label}.fills`)),
    ]);

    return {
      balances: balances ?? [],
      openOrders: openOrders ?? [],
      recentFills: recentFills ?? [],
    };
  }

  private onError(label: string) {
    return (err: unknown): null => {
      this.log.error({ err, label }, "State recovery fetch failed");
      return null;
    };
  }
}
