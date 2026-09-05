"use client";
import { useState } from "react";
import type { DashboardZones } from "@/types";
export interface PricePoint { t: number; price: number; }
export function PriceChart({ points, mark, zones }: { points: PricePoint[]; mark: number | null; zones: DashboardZones }) {
  const [mode, setMode] = useState<"price" | "zones">("price");
  const [hover, setHover] = useState<number | null>(null);
  const W = 800, H = 290, left = 4, right = 76, top = 16, bottom = 30;
  const plotW = W - left - right, plotH = H - top - bottom;
  const valid = points.filter(p => Number.isFinite(p.price) && Number.isFinite(p.t));
  const prices = valid.map(p => p.price);
  const low = Math.min(...prices, ...(mode === "zones" ? [zones.zoneALow, zones.activeBandLow] : []));
  const high = Math.max(...prices, ...(mode === "zones" ? [zones.zoneCHigh, zones.activeBandHigh] : []));
  const pad = Math.max((high - low) * .15, Math.abs(mark ?? 0) * .0005, .000001);
  const min = low - pad, max = high + pad;
  const first = valid[0], last = valid[valid.length - 1];
  const x = (t: number) => left + (t - (first?.t ?? 0)) / Math.max(1, (last?.t ?? 0) - (first?.t ?? 0)) * plotW;
  const y = (v: number) => top + (1 - (v - min) / (max - min)) * plotH;
  const line = valid.map((p,i) => `${i ? "L" : "M"}${x(p.t)},${y(p.price)}`).join(" ");
  const selected = hover == null ? null : valid[Math.min(hover, valid.length - 1)];
  const time = (t: number) => new Date(t).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
  const zone = mark == null ? "Waiting for market data" : mark < zones.zoneALow ? "Below strategy range" : mark < zones.zoneAHigh ? "Zone A / Accumulate" : mark < zones.zoneBHigh ? "Zone B / Primary harvest" : mark <= zones.zoneCHigh ? "Zone C / Expansion" : "Above strategy range";
  const bands = [
    {label:"A / Accumulate",low:zones.zoneALow,high:zones.zoneAHigh,fill:"#58d8e8",labelColor:"#8be7f1"},
    {label:"B / Primary harvest",low:zones.zoneBLow,high:zones.zoneBHigh,fill:"#f4b860",labelColor:"#f5c989"},
    {label:"C / Expansion",low:zones.zoneCLow,high:zones.zoneCHigh,fill:"#b39bfa",labelColor:"#c9b7ff"},
  ];
  return <section className="card chart-card" aria-label="ZIG market chart">
    <div className="chart-heading"><div><h2>Market performance</h2><p className="market-price">{(selected?.price ?? mark)?.toFixed(6) ?? "\u2014"}<small>USDT</small></p><p className="chart-zone"><i />{selected ? time(selected.t) : zone}</p></div>
      <div className="chart-switch" aria-label="Chart scale">{(["price","zones"] as const).map(v => <button key={v} aria-pressed={mode === v} onClick={() => {setMode(v);setHover(null);}}>{v === "price" ? "Price" : "Strategy zones"}</button>)}</div>
    </div>
    {valid.length < 2 ? <div className="chart-empty"><strong>Watching the market</strong><p>Price history will appear as market updates arrive.</p><span>History starts when you open this workspace.</span></div> :
    <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`ZIG price from ${time(first.t)} to ${time(last.t)}. ${zone}.`}
      onPointerLeave={() => setHover(null)} onPointerMove={e => { const rect=e.currentTarget.getBoundingClientRect(); const target=first.t + Math.max(0, Math.min(1, ((e.clientX-rect.left)/rect.width*W-left)/plotW))*(last.t-first.t); let closest=0; valid.forEach((p,i)=>{if(Math.abs(p.t-target)<Math.abs(valid[closest].t-target))closest=i;});setHover(closest); }}>
      <defs><linearGradient id="market-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#58d8e8" stopOpacity=".22"/><stop offset="100%" stopColor="#58d8e8" stopOpacity=".01"/></linearGradient></defs>
      <rect width={W} height={H} rx="8" fill="#111d30"/>
      {mode === "zones" && bands.map(b=><g key={b.label}><rect x={left} y={y(b.high)} width={plotW} height={y(b.low)-y(b.high)} fill={b.fill} fillOpacity=".1"/><text x={left+10} y={y(b.high)+16} fontSize="10" fontWeight="500" fill={b.labelColor}>{b.label} / {b.low.toFixed(3)} - {b.high.toFixed(3)}</text></g>)}
      {Array.from({length:5},(_,i)=>{const v=min+(max-min)*i/4;return <g key={i}><line x1={left} x2={W-right} y1={y(v)} y2={y(v)} stroke="#293b51" strokeDasharray="3 5"/><text textAnchor="end" x={W-2} y={y(v)+4} fontSize="11" fill="#9aaec5" fontFamily="sans-serif">{v.toFixed(6)}</text></g>;})}
      <path d={`${line} L${x(last.t)},${top+plotH} L${left},${top+plotH} Z`} fill="url(#market-area)"/>
      <path d={line} fill="none" stroke="#58d8e8" strokeOpacity=".1" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round"/>
      <path d={line} fill="none" stroke="#58d8e8" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={x(last.t)} cy={y(last.price)} r="7" fill="#58d8e8" fillOpacity=".16"/>
      <circle cx={x(last.t)} cy={y(last.price)} r="4" fill="#58d8e8" stroke="#111d30" strokeWidth="2"/>
      {[0,.25,.5,.75,1].map(f=><text key={f} x={left+plotW*f} y={H-5} textAnchor={f===0?"start":f===1?"end":"middle"} fontSize="10" fill="#9aaec5">{time(first.t+(last.t-first.t)*f)}</text>)}
      {selected && <g><line x1={x(selected.t)} x2={x(selected.t)} y1={top} y2={top+plotH} stroke="#8ca6c3" strokeDasharray="4 4"/><circle cx={x(selected.t)} cy={y(selected.price)} r="5" fill="#58d8e8" stroke="#111d30" strokeWidth="2"/></g>}
    </svg>}
    <div className="chart-footer"><span className="chart-legend"><i />ZIG / USDT <span>/ MEXC</span></span><span>{mode === "zones" ? "Bands from active engine configuration" : "Observed price / Since opening workspace"}</span></div>
  </section>;
}
