// ── Accumulation budget + dry-powder protection ─────────────────────────────────
//
// Caps how much USDT accumulation may deploy: total budget %, daily %, overall
// deployed %, AND never below the dry-powder floor — and never the USDT earmarked
// to complete open harvest cycles (harvest rebuys have priority).
// ──────────────────────────────────────────────────────────────────────────────

function startOfUtcDay(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export interface BudgetSnapshot {
  deployed: number;
  budgetRemaining: number;
  dailyRemaining: number;
}

export class AccumulationBudget {
  private deployed = 0;
  private dailyDeployed = 0;
  private dayStart = startOfUtcDay();

  constructor(
    private readonly startingUsdt: number,
    private readonly budgetPct: number,
    private readonly dailyPct: number,
    private readonly totalDeployedPct: number,
    private readonly minUsdtFloor: number
  ) {}

  private rollDay(): void {
    const d = startOfUtcDay();
    if (d !== this.dayStart) {
      this.dayStart = d;
      this.dailyDeployed = 0;
    }
  }

  // Max USDT a single accumulation buy may spend right now.
  maxSpend(usdtBalance: number, harvestRebuyReserve: number): number {
    this.rollDay();
    const remBudget = Math.max(this.startingUsdt * this.budgetPct - this.deployed, 0);
    const remDaily = Math.max(this.startingUsdt * this.dailyPct - this.dailyDeployed, 0);
    const remTotal = Math.max(this.startingUsdt * this.totalDeployedPct - this.deployed, 0);
    // Dry powder: keep the floor AND the USDT owed to finish open harvest cycles.
    const dryPowder = Math.max(usdtBalance - this.minUsdtFloor - harvestRebuyReserve, 0);
    return Math.max(Math.min(remBudget, remDaily, remTotal, dryPowder), 0);
  }

  record(spentUsdt: number): void {
    this.rollDay();
    this.deployed += spentUsdt;
    this.dailyDeployed += spentUsdt;
  }

  snapshot(): BudgetSnapshot {
    this.rollDay();
    return {
      deployed: this.deployed,
      budgetRemaining: Math.max(this.startingUsdt * this.budgetPct - this.deployed, 0),
      dailyRemaining: Math.max(this.startingUsdt * this.dailyPct - this.dailyDeployed, 0),
    };
  }
}
