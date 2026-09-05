import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { getConfig } from "@zig/config";
import { createLogger } from "@zig/logger";
import type { NormalizedMarketState } from "@zig/shared-types";
import { runSimulation, type SimResult } from "./sim-harness.js";
import { makeRng, classifyVolatility } from "./market-replay.js";
import type { Candle } from "./fetch-history.js";

async function main(): Promise<void> {
// Offline review only. No exchange clients, account keys, server, or live orders.
const output = path.resolve(process.cwd(), "../artifacts/simulation");
const now = Date.now();
const cfg = { ...getConfig(), OPERATIONAL_MODE: "PAPER_MODE" as const, PAPER_SOAK_ENABLED: false };
const log = createLogger("strategy-review", "error");
const HOUR = 3_600_000;
const seeds = Number(process.argv[2] ?? 100);
const readJson = async (p: string) => JSON.parse(await readFile(p, "utf8"));
const cached = await readJson(path.resolve("data/zig-1h.json"));
const latestGate = await readJson(path.join(output, "gateHourly.json"));
const latestMexc = await readJson(path.join(output, "mexcHourly.json"));
const snapshot = await readJson(path.join(output, "mexcDepth.json"));
const ticker = await readJson(path.join(output, "mexcTicker.json"));
const merged = new Map<number, Candle>(cached.candles.map((c: Candle) => [c.t, c]));
for (const r of latestGate.data) {
  if (r[7] !== "true") continue;
  merged.set(Number(r[0])*1000,{t:Number(r[0])*1000,o:Number(r[5]),h:Number(r[3]),l:Number(r[4]),c:Number(r[2]),v:Number(r[6])});
}
const valid = (c: Candle) => c.t + HOUR <= now && [c.o,c.h,c.l,c.c,c.v,c.t].every(Number.isFinite) && c.l>0 && c.v>=0 && c.l<=Math.min(c.o,c.c) && c.h>=Math.max(c.o,c.c);
const gate: Candle[] = [...merged.values()].filter(valid).sort((a,b)=>a.t-b.t);
const mexc: Candle[] = latestMexc.data.map((r: Array<string|number>)=>({t:Number(r[0]),o:Number(r[1]),h:Number(r[2]),l:Number(r[3]),c:Number(r[4]),v:Number(r[5])})).filter(valid).filter((c: Candle)=>c.t+HOUR<=latestMexc.fetchedAt);
for (const [name,cs] of [["Gate",gate],["MEXC",mexc]] as const) {
  if (!cs.length || cs.some((c,i)=>i>0 && c.t-cs[i-1].t!==HOUR)) throw Error(`${name}: empty or discontinuous history`);
}
await mkdir(output,{recursive:true});
await writeFile(path.join(output,"closed-hourly-inputs.json"),JSON.stringify({gate,mexc}));
const inputHash=createHash("sha256").update(JSON.stringify({gate,mexc})).digest("hex");
const liveUnits=(m:NormalizedMarketState):NormalizedMarketState=>({...m,bidLiquidity:m.bidLiquidity*(m.bestBid??0),askLiquidity:m.askLiquidity*(m.bestAsk??0)});
const bid=Number(ticker.data.bidPrice),ask=Number(ticker.data.askPrice),mid=(bid+ask)/2,spreadBps=10000*(ask-bid)/mid;
const bidBase=snapshot.data.bids.slice(0,10).reduce((s:number,r:string[])=>s+Number(r[1]),0);
const askBase=snapshot.data.asks.slice(0,10).reduce((s:number,r:string[])=>s+Number(r[1]),0);
// A sensitivity only: today's book cannot stand in for historical order-book data.
const snapshotBook=(m:NormalizedMarketState):NormalizedMarketState=>{
 const p=m.midPrice!;const half=p*spreadBps/20000;return {...m,bestBid:p-half,bestAsk:p+half,spread:2*half,spreadBps,volatilityRegime:classifyVolatility(spreadBps),bidLiquidity:bidBase*p,askLiquidity:askBase*p};
};
const profiles = { legacy_replay: undefined, current_live_units: liveUnits, snapshot_book_sensitivity: snapshotBook };
type Row = { name:string; profile:string; source:string; from:string; to:string; result:SimResult };
const rows:Row[]=[];
async function run(name:string,source:string,candles:Candle[],profile:keyof typeof profiles,seed:number) {
 const result=await runSimulation({cfg,candles,seed,exchange:"mexc",startZig:cfg.SOAK_VIRTUAL_ZIG,startUsdt:cfg.SOAK_VIRTUAL_USDT,log,marketTransform:profiles[profile]});
 const row={name,profile,source,from:new Date(candles[0].t).toISOString(),to:new Date(candles.at(-1)!.t+HOUR).toISOString(),result};rows.push(row);return row;
}
const cases = [{name:"Recent 7 days",source:"MEXC",candles:mexc.slice(-168)},{name:"Recent 30 days",source:"gate.io",candles:gate.slice(-720)},{name:"Recent MEXC history",source:"MEXC",candles:mexc}];
const blocks:Candle[][]=[];for(let i=0;i+720<=gate.length;i+=720)blocks.push(gate.slice(i,i+720));
const ret=(cs:Candle[])=>cs.at(-1)!.c/cs[0].o-1;
cases.push({name:"Largest rising 30-day block",source:"gate.io",candles:blocks.reduce((a,b)=>ret(a)>ret(b)?a:b)});
cases.push({name:"Largest falling 30-day block",source:"gate.io",candles:blocks.reduce((a,b)=>ret(a)<ret(b)?a:b)});
const inBand=(cs:Candle[])=>cs.filter(c=>c.c>=.05&&c.c<=.075).length;
cases.push({name:"Most time in harvest band",source:"gate.io",candles:blocks.reduce((a,b)=>inBand(a)>inBand(b)?a:b)});
for(const scenario of cases.filter(c=>process.argv[3]!=="recent-week-only" || c.name==="Recent 7 days")) for(const profile of Object.keys(profiles) as (keyof typeof profiles)[]) {
 const row=await run(scenario.name,scenario.source,scenario.candles,profile,42);
 console.log(JSON.stringify({case:row.name,profile,harvest:row.result.harvestedUsdt,zigDelta:row.result.endZig-row.result.startZig,vsHold:row.result.navVsHold,passed:row.result.passed}));
}
const pick=makeRng(20260905);
for(let i=0;i<seeds;i++) {
 const length=168+Math.floor(pick()*(720-168));const start=Math.floor(pick()*(gate.length-length));
 const candles=gate.slice(start,start+length);
 for(const profile of ["legacy_replay","current_live_units"] as const) await run(`Window ${i+1}`,"gate.io",candles,profile,i+1);
 if((i+1)%20===0)console.log(`Completed ${i+1}/${seeds} paired windows`);
}
const mean=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length;
const quantile=(a:number[],p:number)=>[...a].sort((a,b)=>a-b)[Math.min(a.length-1,Math.floor(a.length*p))];
const stats:Record<string,unknown>={};
for(const profile of ["legacy_replay","current_live_units"] as const) {
 const rs=rows.filter(r=>r.profile===profile&&r.name.startsWith("Window ")).map(r=>r.result);
 if(!rs.length) continue;
 const metric=(fn:(r:SimResult)=>number)=>{const a=rs.map(fn);return {mean:mean(a),median:quantile(a,.5),p05:quantile(a,.05),p95:quantile(a,.95),min:Math.min(...a),max:Math.max(...a)};};
 stats[profile]={runs:rs.length,passed:rs.filter(r=>r.passed).length,halted:rs.filter(r=>r.halted).length,beatHold:rs.filter(r=>r.navVsHold>1e-6).length,tiedHold:rs.filter(r=>Math.abs(r.navVsHold)<=1e-6).length,zeroFills:rs.filter(r=>r.harvestSells+r.harvestBuys+r.accBuys+r.accRecoveries===0).length,harvestedUsdt:metric(r=>r.harvestedUsdt),navVsHold:metric(r=>r.navVsHold),netZig:metric(r=>r.endZig-r.startZig),surplusZig:metric(r=>r.surplusZig),cashChange:metric(r=>r.endUsdt-r.startUsdt),fees:metric(r=>r.feesUsdt),unrecoveredZig:metric(r=>r.unrecoveredZig),maxDrawdownPct:metric(r=>r.maxDrawdownPct),minZig:Math.min(...rs.map(r=>r.minZig)),minUsdt:Math.min(...rs.map(r=>r.minUsdt)),zoneFlipFills:rs.reduce((s,r)=>s+r.zoneFlipFills,0),breaches:rs.flatMap(r=>r.breaches)};
}
const assumptions={startingZig:cfg.SOAK_VIRTUAL_ZIG,reserveZig:cfg.RESERVE_FLOOR,activeZig:cfg.SOAK_VIRTUAL_ZIG-cfg.RESERVE_FLOOR,startingUsdt:cfg.SOAK_VIRTUAL_USDT,feeBpsPerFill:cfg.PAPER_TAKER_FEE_BPS,slippageBpsPerFill:cfg.PAPER_SLIPPAGE_BPS,marketableFillProbabilityPerTick:cfg.PAPER_FILL_PROBABILITY,tickSeconds:cfg.SOAK_TICK_SECONDS,rebuyBps:[cfg.REBUY_DISTANCE_LOW_VOL_BPS,cfg.REBUY_DISTANCE_NORMAL_VOL_BPS,cfg.REBUY_DISTANCE_HIGH_VOL_BPS,cfg.REBUY_DISTANCE_CHAOTIC_BPS]};
const report={generatedAt:new Date().toISOString(),inputHash,history:{from:new Date(gate[0].t).toISOString(),to:new Date(gate.at(-1)!.t+HOUR).toISOString(),gateHours:gate.length,mexcHours:mexc.length,excludedUnfinishedCandles:true},snapshot:{at:new Date(ticker.fetchedAt).toISOString(),mid,spreadBps,bidTop10Base:bidBase,askTop10Base:askBase},assumptions,stats,rows};
await writeFile(path.join(output,process.argv[3]==="recent-week-only" ? "strategy-review-recent-week.json" : "strategy-review.json"),JSON.stringify(report,null,2));
console.log(JSON.stringify({history:report.history,stats},null,2));

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
