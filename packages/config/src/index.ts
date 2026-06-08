import dotenv from "dotenv";
import { z } from "zod";
import path from "path";

// Walk up from packages/config/dist/ to find the monorepo root .env
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const OperationalModeSchema = z.enum([
  "READ_ONLY",
  "PAPER_MODE",
  "NORMAL",
  "DEFENSIVE",
  "HALT",
]);

const positivePct = z.coerce.number().gt(0).lte(1);
const nonnegativePct = z.coerce.number().gte(0).lte(1);
const positiveNumber = z.coerce.number().gt(0);
const nonnegativeNumber = z.coerce.number().gte(0);
const positivePrice = z.coerce.number().gt(0);
// Env booleans: z.coerce.boolean() treats the string "false" as true, so parse explicitly.
const boolFlag = (def: "true" | "false") => z.enum(["true", "false"]).default(def).transform((v) => v === "true");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  OPERATIONAL_MODE: OperationalModeSchema.default("READ_ONLY"),

  // Exchange keys are NOT config. They are user-owned session credentials
  // submitted via frontend and managed by TradingSession + CredentialVault.

  DATABASE_URL: z.string().default("postgresql://postgres:postgres@localhost:5432/zig_treasury"),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // SYSTEM secret (allowed in env). 32 bytes as 64 hex chars — master key that
  // encrypts user exchange credentials at rest (AES-256-GCM). If empty, an
  // ephemeral key is generated at boot (dev only — credentials won't survive restart).
  ENCRYPTION_KEY: z.string().regex(/^([0-9a-fA-F]{64})?$/, "ENCRYPTION_KEY must be 64 hex chars (32 bytes) or empty").default(""),

  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_CHAT_ID: z.string().default(""),
  TELEGRAM_ALLOWED_USER_IDS: z.string().default(""),

  TRADING_SYMBOL: z.string().default("ZIGUSDT"),

  // ── Treasury accounting ─────────────────────────────────────────────────
  BASE_ASSET: z.string().default("ZIG"),
  QUOTE_ASSET: z.string().default("USDT"),
  // Protected reserve floor (base asset). Holdings above this are "active"
  // (harvestable); the floor is never sold into. 0 = entire balance active.
  RESERVE_FLOOR: z.coerce.number().nonnegative().default(0),

  // Phase 5 risk / sizing params. These are required: invalid or missing
  // values must fail startup so execution never runs with implicit risk limits.
  MAX_ORDER_ACTIVE_PCT: positivePct,
  MAX_DAILY_SELL_ACTIVE_PCT: positivePct,
  MAX_DAILY_BUY_USDT_PCT: positivePct,
  LIQUIDITY_PARTICIPATION_PCT: positivePct,
  DEFENSIVE_SIZE_MULTIPLIER: nonnegativePct,
  HIGH_VOL_SIZE_MULTIPLIER: nonnegativePct,
  CHAOTIC_SIZE_MULTIPLIER: nonnegativePct,
  MIN_ORDER_ZIG: positiveNumber,
  MAX_OPEN_ORDERS_PER_EXCHANGE: z.coerce.number().int().positive(),
  MIN_SELL_PROFIT_BPS: nonnegativeNumber,
  MIN_REBUY_DISTANCE_BPS: nonnegativeNumber,
  MAX_SPREAD_BPS: positiveNumber,
  CHAOTIC_SPREAD_MULTIPLIER: positiveNumber,
  MAX_15M_MOVE_PCT: positivePct,
  LOW_VOL_ATR_PCT: positivePct,
  NORMAL_VOL_ATR_PCT: positivePct,
  HIGH_VOL_ATR_PCT: positivePct,
  MAX_RECONNECTS_PER_5M: z.coerce.number().int().nonnegative(),
  RECONCILIATION_REQUIRED_STATUS: z.enum(["MATCH"]),

  // ── Paper soak (live-market forward test) ─────────────────────────────────
  // A headless dry-run: real market data, virtual money, real Phase 5 rules.
  // SAFETY: the auto harvest-driver only ever runs when OPERATIONAL_MODE is
  // PAPER_MODE. It is hard-disabled in NORMAL/DEFENSIVE so it can never auto-trade
  // real funds. All vars default to a disabled/no-op state.
  PAPER_SOAK_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  SOAK_EXCHANGE: z.enum(["bybit", "mexc"]).default("bybit"),
  SOAK_VIRTUAL_ZIG: nonnegativeNumber.default(0),   // virtual total ZIG holdings
  SOAK_VIRTUAL_USDT: nonnegativeNumber.default(0),  // virtual USDT for rebuys
  SOAK_ENTRY_COST: z.coerce.number().nonnegative().default(0), // cost basis of opening ZIG; 0 = use market mid at boot
  SOAK_TICK_SECONDS: z.coerce.number().int().positive().default(30), // how often the driver evaluates
  SOAK_BUY_SLICE_PCT: nonnegativePct.default(0.2),  // fraction of USDT per rebuy intent

  // ── Paper soak v2 — discipline, cycles, realism ───────────────────────────
  // Cooldowns + buckets stop machine-gun trading in the same price zone.
  SELL_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(120),
  BUY_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(120),
  SELL_BUCKET_BPS: positiveNumber.default(25),
  BUY_BUCKET_BPS: positiveNumber.default(25),
  REJECT_BACKOFF_SECONDS: z.coerce.number().int().nonnegative().default(300),
  // Cap on how much active inventory may sit sold-but-not-rebought.
  // MAX_ACTIVE_DEPLOYED_PCT is a compatibility alias; the authoritative check uses
  // MAX_UNRECOVERED_ACTIVE_PCT (unrecoveredSold >= startingActive × pct → pause sells).
  MAX_ACTIVE_DEPLOYED_PCT: positivePct.default(0.25),
  MAX_UNRECOVERED_ACTIVE_PCT: positivePct.default(0.25),
  // Paper fill realism (less optimistic than v1).
  PAPER_TAKER_FEE_BPS: nonnegativeNumber.default(10),
  PAPER_SLIPPAGE_BPS: nonnegativeNumber.default(5),
  PAPER_FILL_PROBABILITY: positivePct.default(0.75),
  // Telegram throttling — summaries instead of per-fill spam.
  TG_FILL_SUMMARY_INTERVAL_SECONDS: z.coerce.number().int().positive().default(900),
  TG_REJECT_SUMMARY_INTERVAL_SECONDS: z.coerce.number().int().positive().default(900),

  // ── Zone Manager (operator-defined treasury zones) ────────────────────────
  // Strategy anchors on the current market ZONE, not on unknown historical avg cost.
  ZONE_MANAGER_ENABLED: boolFlag("true"),
  ACTIVE_BAND_LOW: positivePrice.default(0.05),
  ACTIVE_BAND_HIGH: positivePrice.default(0.075),
  ZONE_A_LOW: positivePrice.default(0.045),
  ZONE_A_HIGH: positivePrice.default(0.05),
  ZONE_B_LOW: positivePrice.default(0.05),
  ZONE_B_HIGH: positivePrice.default(0.06),
  ZONE_C_LOW: positivePrice.default(0.06),
  ZONE_C_HIGH: positivePrice.default(0.075),
  ZONE_EVALUATION_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  // Per-zone behavior toggles
  ZONE_A_ACCUMULATION_ENABLED: boolFlag("true"),
  ZONE_A_SELLS_ENABLED: boolFlag("false"),
  ZONE_B_HARVEST_ENABLED: boolFlag("true"),
  ZONE_B_ACCUMULATION_ENABLED: boolFlag("false"),
  ZONE_C_HARVEST_ENABLED: boolFlag("true"),
  ZONE_C_ACCUMULATION_ENABLED: boolFlag("false"),

  // ── Controlled accumulation (buy deep weakness → recover principal → keep surplus ZIG)
  ACCUMULATION_ENABLED: boolFlag("true"),
  ACCUMULATION_TRANCHE_USDT: positiveNumber.default(1000),
  MAX_ACCUMULATION_BUDGET_USDT_PCT: positivePct.default(0.3),
  MAX_DAILY_ACCUMULATION_USDT_PCT: positivePct.default(0.1),
  ACCUMULATION_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(900),
  ACCUMULATION_BUCKET_BPS: positiveNumber.default(100),
  ACCUMULATION_MIN_LIQUIDITY_USDT: nonnegativeNumber.default(5000),
  ACCUMULATION_MAX_SPREAD_BPS: positiveNumber.default(150),
  ACCUMULATION_ALLOW_IN_HIGH_VOL: boolFlag("false"),
  ACCUMULATION_ALLOW_IN_CHAOTIC: boolFlag("false"),
  // Recovery
  ACCUMULATION_RECOVERY_ENABLED: boolFlag("true"),
  ACCUMULATION_RECOVERY_PROFIT_BPS: nonnegativeNumber.default(500),
  ACCUMULATION_PRINCIPAL_RECOVERY_PCT: positivePct.default(1.0),
  ACCUMULATION_KEEP_SURPLUS_ZIG: boolFlag("true"),
  // Dry powder protection (USDT-side reserve floor)
  MIN_USDT_RESERVE_FLOOR: nonnegativeNumber.default(5000),
  MAX_TOTAL_USDT_DEPLOYED_PCT: positivePct.default(0.5),

  // ── Control-plane security ──────────────────────────────────────────────
  // API bind host + port. 0.0.0.0 is reachable from the network; set to
  // 127.0.0.1 when running behind a reverse proxy (recommended in prod).
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().default(3001),

  // Operator token — required header `x-operator-token` for all /api/operator/*
  // (control) routes. Empty = control routes DISABLED (fail closed). Set a strong
  // random value in production. Generate: openssl rand -hex 32
  OPERATOR_TOKEN: z.string().default(""),

  // CORS allow-list for the dashboard origin. "*" only acceptable in local dev.
  DASHBOARD_ORIGIN: z.string().default("http://localhost:3000"),
}).superRefine((env, ctx) => {
  const bad = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

  if (!(env.LOW_VOL_ATR_PCT < env.NORMAL_VOL_ATR_PCT && env.NORMAL_VOL_ATR_PCT < env.HIGH_VOL_ATR_PCT)) {
    bad("LOW_VOL_ATR_PCT", "volatility ATR thresholds must satisfy LOW < NORMAL < HIGH");
  }

  // Zone bounds: each zone low<high, active band low<high, zones non-overlapping & ascending.
  if (!(env.ACTIVE_BAND_LOW < env.ACTIVE_BAND_HIGH)) bad("ACTIVE_BAND_LOW", "ACTIVE_BAND_LOW must be < ACTIVE_BAND_HIGH");
  if (!(env.ZONE_A_LOW < env.ZONE_A_HIGH)) bad("ZONE_A_LOW", "ZONE_A_LOW must be < ZONE_A_HIGH");
  if (!(env.ZONE_B_LOW < env.ZONE_B_HIGH)) bad("ZONE_B_LOW", "ZONE_B_LOW must be < ZONE_B_HIGH");
  if (!(env.ZONE_C_LOW < env.ZONE_C_HIGH)) bad("ZONE_C_LOW", "ZONE_C_LOW must be < ZONE_C_HIGH");
  if (!(env.ZONE_A_HIGH <= env.ZONE_B_LOW)) bad("ZONE_A_HIGH", "ZONE_A_HIGH must be <= ZONE_B_LOW (zones must not overlap)");
  if (!(env.ZONE_B_HIGH <= env.ZONE_C_LOW)) bad("ZONE_B_HIGH", "ZONE_B_HIGH must be <= ZONE_C_LOW (zones must not overlap)");
});

export function parseConfig(env: NodeJS.ProcessEnv) {
  const result = EnvSchema.safeParse(env);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  ${e.path.join(".")}: ${e.message}`)
      .join("\n");
    throw new Error(`Configuration validation failed:\n${errors}`);
  }

  return result.data;
}

export type Config = z.infer<typeof EnvSchema>;
export type OperationalMode = z.infer<typeof OperationalModeSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = parseConfig(process.env);
  }
  return _config;
}

export function getOperationalMode(): OperationalMode {
  return getConfig().OPERATIONAL_MODE;
}
