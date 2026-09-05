import assert from "node:assert/strict";
import { getConfig } from "@zig/config";
import { createLogger } from "@zig/logger";
import { runSimulation } from "./sim-harness.js";

async function main() {
  const OriginalDate = Date;
  const start = Date.UTC(2024,0,1,23);
  const candles = [0,1].map(h=>({t:start+h*3600000,o:.049,h:.049,l:.049,c:.049,v:100000}));
  const cfg = {...getConfig(),ACCUMULATION_ENABLED:false,ZONE_A_SELLS_ENABLED:true};
  let checked = 0;
  const result=await runSimulation({cfg,candles,seed:44,exchange:"mexc",startZig:6000000,startUsdt:15000,log:createLogger("sim-test","error"),marketTransform:m=>{
    assert.equal(new Date().getTime(),Date.now(),"Calendar dates must advance with the virtual clock");
    checked++;return m;
  }});
  assert.equal(Date,OriginalDate,"Restore the real Date constructor after replay");
  assert.equal(checked,240);
  assert.ok(result.harvestSells>0,"Fixture must generate immediate paper sell fills");
  assert.ok(result.breaches.some(b=>b.code==="HARVEST_SELL_DECIDED_IN_ZONE_A"),"Immediate fills must carry their decision zone into invariants");
  assert.ok(Math.abs(result.ledgerCashError)<1e-6);
  assert.ok(Math.abs(result.ledgerZigError)<1e-6);
  await assert.rejects(runSimulation({cfg,candles,seed:44,exchange:"mexc",startZig:6000000,startUsdt:15000,log:createLogger("sim-test","error"),marketTransform:()=>{throw Error("fixture failure");}}));
  assert.equal(Date,OriginalDate,"Restore the clock even after a thrown replay error");
  console.log("Simulation audit regression checks passed: virtual dates, immediate-fill zones, cash/inventory conservation, clock restoration.");
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
