export class OrderbookEngine {
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();
  private lastUpdateAt = 0;
  private _lastSequence = 0;

  get lastSequence(): number {
    return this._lastSequence;
  }

  applySnapshot(
    bids: [string, string][],
    asks: [string, string][],
    sequence: number
  ): void {
    this.bids.clear();
    this.asks.clear();

    for (const [price, size] of bids) {
      const p = parseFloat(price);
      const s = parseFloat(size);
      if (s > 0) this.bids.set(p, s);
    }

    for (const [price, size] of asks) {
      const p = parseFloat(price);
      const s = parseFloat(size);
      if (s > 0) this.asks.set(p, s);
    }

    this._lastSequence = sequence;
    this.lastUpdateAt = Date.now();
  }

  applyDelta(bids: [string, string][], asks: [string, string][], sequence: number): void {
    for (const [price, size] of bids) {
      const p = parseFloat(price);
      const s = parseFloat(size);
      if (s === 0) {
        this.bids.delete(p);
      } else {
        this.bids.set(p, s);
      }
    }

    for (const [price, size] of asks) {
      const p = parseFloat(price);
      const s = parseFloat(size);
      if (s === 0) {
        this.asks.delete(p);
      } else {
        this.asks.set(p, s);
      }
    }

    this._lastSequence = sequence;
    this.lastUpdateAt = Date.now();
  }

  bestBid(): number | null {
    if (this.bids.size === 0) return null;
    return Math.max(...this.bids.keys());
  }

  bestAsk(): number | null {
    if (this.asks.size === 0) return null;
    return Math.min(...this.asks.keys());
  }

  bidLiquidity(levels: number): number {
    const sorted = [...this.bids.keys()].sort((a, b) => b - a).slice(0, levels);
    return sorted.reduce((sum, price) => sum + (this.bids.get(price) ?? 0) * price, 0);
  }

  askLiquidity(levels: number): number {
    const sorted = [...this.asks.keys()].sort((a, b) => a - b).slice(0, levels);
    return sorted.reduce((sum, price) => sum + (this.asks.get(price) ?? 0) * price, 0);
  }

  freshnessMs(): number {
    return this.lastUpdateAt > 0 ? Date.now() - this.lastUpdateAt : Infinity;
  }

  isEmpty(): boolean {
    return this.bids.size === 0 && this.asks.size === 0;
  }

  reset(): void {
    this.bids.clear();
    this.asks.clear();
    this._lastSequence = 0;
    this.lastUpdateAt = 0;
  }
}
