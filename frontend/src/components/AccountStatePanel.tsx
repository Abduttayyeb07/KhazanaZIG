"use client";

import type {
  DashboardAccountState,
  DashboardBalance,
  DashboardFill,
  DashboardOrder,
  DashboardReconciliation,
} from "@/types";

interface Props {
  account: DashboardAccountState;
}

type ExchangeKey = "bybit" | "mexc";

const statusClass: Record<string, string> = {
  MATCH: "text-emerald-300 bg-emerald-950/60 border-emerald-800",
  SOFT_DRIFT: "text-yellow-300 bg-yellow-950/50 border-yellow-800",
  HARD_DRIFT: "text-orange-300 bg-orange-950/50 border-orange-800",
  CRITICAL_DRIFT: "text-red-300 bg-red-950/60 border-red-800",
};

function fmtAmount(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1_000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return value.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function fmtPrice(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function fmtTime(value: number | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString("en-US", { hour12: false });
}

function shortId(value: string): string {
  if (!value) return "-";
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function AccountStatePanel({ account }: Props) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="text-white font-semibold text-sm">Account State</span>
          <p className="text-zinc-500 text-xs mt-0.5">
            Exchange truth from recovery and reconciliation
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {(["bybit", "mexc"] as const).map((exchange) => (
          <ExchangeAccountState
            key={exchange}
            exchange={exchange}
            balances={account.balances[exchange]}
            openOrders={account.openOrders[exchange]}
            fills={account.fills[exchange]}
            reconciliation={account.reconciliation[exchange]}
          />
        ))}
      </div>
    </div>
  );
}

function ExchangeAccountState({
  exchange,
  balances,
  openOrders,
  fills,
  reconciliation,
}: {
  exchange: ExchangeKey;
  balances: DashboardBalance[];
  openOrders: DashboardOrder[];
  fills: DashboardFill[];
  reconciliation: DashboardReconciliation | null;
}) {
  const visibleBalances = balances.filter((b) => Math.abs(b.total) > 0);
  const recentFills = fills.slice(-6).reverse();

  return (
    <div className="bg-surface border border-border rounded-lg p-4 flex flex-col gap-4 min-w-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-zinc-200 text-sm font-semibold uppercase">{exchange}</span>
        <ReconciliationBadge reconciliation={reconciliation} />
      </div>

      <section className="flex flex-col gap-2">
        <SectionHeader label="Balances" count={visibleBalances.length} />
        {visibleBalances.length === 0 ? (
          <EmptyLine text="No non-zero balances reported" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-zinc-500">
                <tr className="text-left">
                  <th className="py-1 pr-3 font-normal">Asset</th>
                  <th className="py-1 px-3 font-normal text-right">Available</th>
                  <th className="py-1 px-3 font-normal text-right">Locked</th>
                  <th className="py-1 pl-3 font-normal text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {visibleBalances.map((balance) => (
                  <tr key={balance.asset} className="border-t border-border/70">
                    <td className="py-2 pr-3 text-zinc-200">{balance.asset}</td>
                    <td className="py-2 px-3 text-right text-zinc-300">{fmtAmount(balance.available)}</td>
                    <td className="py-2 px-3 text-right text-zinc-400">{fmtAmount(balance.locked)}</td>
                    <td className="py-2 pl-3 text-right text-white">{fmtAmount(balance.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <SectionHeader label="Open Orders" count={openOrders.length} />
        {openOrders.length === 0 ? (
          <EmptyLine text="No open orders" />
        ) : (
          <div className="flex flex-col gap-2">
            {openOrders.map((order) => (
              <div key={order.clientOrderId || order.orderId} className="bg-card/70 border border-border rounded-md p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className={order.side === "buy" ? "text-emerald-300 uppercase" : "text-red-300 uppercase"}>
                    {order.side}
                  </span>
                  <span className="text-zinc-500">{order.status}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-zinc-300">
                  <span>{fmtAmount(order.remainingSize)} / {fmtAmount(order.size)}</span>
                  <span className="text-right">@ {fmtPrice(order.price)}</span>
                </div>
                <div className="mt-2 text-zinc-600">client {shortId(order.clientOrderId)}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <SectionHeader label="Recent Fills" count={recentFills.length} />
        {recentFills.length === 0 ? (
          <EmptyLine text="No recent fills loaded" />
        ) : (
          <div className="flex flex-col gap-2">
            {recentFills.map((fill) => (
              <div key={fill.fillId} className="grid grid-cols-[auto_1fr_auto] gap-3 items-center text-xs bg-card/70 border border-border rounded-md px-3 py-2">
                <span className={fill.side === "buy" ? "text-emerald-300 uppercase" : "text-red-300 uppercase"}>
                  {fill.side}
                </span>
                <span className="text-zinc-300 truncate">
                  {fmtAmount(fill.size)} @ {fmtPrice(fill.price)}
                </span>
                <span className="text-zinc-500">{fmtTime(fill.filledAt)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ReconciliationBadge({ reconciliation }: { reconciliation: DashboardReconciliation | null }) {
  if (!reconciliation) {
    return (
      <span className="text-xs font-mono px-2 py-1 rounded border border-border text-zinc-500 bg-card/70">
        no reconciliation
      </span>
    );
  }

  return (
    <span className={`text-xs font-mono px-2 py-1 rounded border ${statusClass[reconciliation.status] ?? statusClass.MATCH}`}>
      {reconciliation.status} / {reconciliation.issues.length}
    </span>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-400 text-xs">{label}</span>
      <span className="text-zinc-600 text-xs font-mono">{count}</span>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="bg-card/60 border border-border rounded-md px-3 py-2 text-xs text-zinc-600">
      {text}
    </div>
  );
}
