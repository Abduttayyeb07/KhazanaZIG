import assert from "node:assert/strict";
import { parseConfig } from "./index.js";

const validEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  LOG_LEVEL: "info",
  OPERATIONAL_MODE: "READ_ONLY",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:15432/zig_treasury",
  REDIS_URL: "redis://localhost:6379",
  ENCRYPTION_KEY: "",
  TELEGRAM_BOT_TOKEN: "",
  TELEGRAM_CHAT_ID: "",
  TELEGRAM_ALLOWED_USER_IDS: "",
  TRADING_SYMBOL: "ZIGUSDT",
  BASE_ASSET: "ZIG",
  QUOTE_ASSET: "USDT",
  RESERVE_FLOOR: "0",
  API_HOST: "127.0.0.1",
  API_PORT: "3001",
  OPERATOR_TOKEN: "token",
  DASHBOARD_ORIGIN: "http://localhost:3000",
  MAX_ORDER_ACTIVE_PCT: "0.05",
  MAX_DAILY_SELL_ACTIVE_PCT: "0.15",
  MAX_DAILY_BUY_USDT_PCT: "0.25",
  LIQUIDITY_PARTICIPATION_PCT: "0.10",
  DEFENSIVE_SIZE_MULTIPLIER: "0.35",
  HIGH_VOL_SIZE_MULTIPLIER: "0.40",
  CHAOTIC_SIZE_MULTIPLIER: "0",
  MIN_ORDER_ZIG: "100",
  MAX_OPEN_ORDERS_PER_EXCHANGE: "5",
  MIN_SELL_PROFIT_BPS: "300",
  MIN_REBUY_DISTANCE_BPS: "300",
  MAX_SPREAD_BPS: "150",
  CHAOTIC_SPREAD_MULTIPLIER: "3",
  MAX_15M_MOVE_PCT: "0.08",
  LOW_VOL_ATR_PCT: "0.01",
  NORMAL_VOL_ATR_PCT: "0.03",
  HIGH_VOL_ATR_PCT: "0.07",
  MAX_RECONNECTS_PER_5M: "5",
  RECONCILIATION_REQUIRED_STATUS: "MATCH",
};

assert.equal(parseConfig(validEnv).MAX_ORDER_ACTIVE_PCT, 0.05);

{
  const env = { ...validEnv };
  delete env.MAX_ORDER_ACTIVE_PCT;
  assert.throws(() => parseConfig(env), /MAX_ORDER_ACTIVE_PCT/);
}

{
  const env = { ...validEnv, MAX_ORDER_ACTIVE_PCT: "1.5" };
  assert.throws(() => parseConfig(env), /MAX_ORDER_ACTIVE_PCT/);
}

{
  const env = { ...validEnv, LOW_VOL_ATR_PCT: "0.05", NORMAL_VOL_ATR_PCT: "0.03" };
  assert.throws(() => parseConfig(env), /volatility ATR thresholds/);
}

console.log("config env tests passed");
