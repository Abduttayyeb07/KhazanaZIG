import axios from "axios";
import type { Logger } from "@zig/logger";
import type { TelegramNotifier } from "./notifier.js";

// ── Telegram command listener (inbound) ─────────────────────────────────────────
//
// Long-polls getUpdates — no webhook, no public URL, no nginx. Perfect for a
// headless box. Only messages from the configured chat (and optional allow-listed
// user ids) are honoured; everything else is ignored. Replies go out via the
// existing notifier.
// ────────────────────────────────────────────────────────────────────────────────

export type CommandHandler = (args: string[], reply: (text: string) => void) => void | Promise<void>;

interface TgUpdate {
  update_id: number;
  message?: { chat?: { id?: number }; from?: { id?: number }; text?: string };
}

export class TelegramCommandListener {
  private readonly token: string;
  private readonly chatId: string;
  private readonly allowedUserIds: Set<string>;
  private readonly tg: TelegramNotifier;
  private readonly log: Logger;
  private readonly handlers = new Map<string, CommandHandler>();
  private readonly enabled: boolean;
  private offset = 0;
  private running = false;

  constructor(token: string, chatId: string, allowedUserIds: string, tg: TelegramNotifier, log: Logger) {
    this.token = token;
    this.chatId = chatId;
    this.allowedUserIds = new Set(allowedUserIds.split(",").map((s) => s.trim()).filter(Boolean));
    this.tg = tg;
    this.log = log.child({ module: "telegram-cmd" });
    this.enabled = token.length > 0 && chatId.length > 0;
  }

  on(command: string, handler: CommandHandler): void {
    this.handlers.set(command.toLowerCase(), handler);
  }

  start(): void {
    if (!this.enabled) {
      this.log.warn("Telegram commands disabled (no token/chat id)");
      return;
    }
    this.running = true;
    void this.loop();
    this.log.info({ commands: [...this.handlers.keys()] }, "Telegram command listener started");
  }

  stop(): void {
    this.running = false;
  }

  private authorized(u: TgUpdate): boolean {
    const fromChat = String(u.message?.chat?.id ?? "");
    const fromUser = String(u.message?.from?.id ?? "");
    if (fromChat && fromChat === this.chatId) return true;
    if (this.allowedUserIds.has(fromUser)) return true;
    return false;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const res = await axios.get(`https://api.telegram.org/bot${this.token}/getUpdates`, {
          params: { offset: this.offset, timeout: 30 },
          timeout: 35_000,
        });
        const updates: TgUpdate[] = res.data?.result ?? [];
        for (const u of updates) {
          this.offset = u.update_id + 1;
          await this.handle(u);
        }
      } catch (err) {
        // Network blip / Telegram hiccup — back off briefly and keep going.
        this.log.debug({ err: err instanceof Error ? err.message : err }, "getUpdates failed; retrying");
        await new Promise((r) => setTimeout(r, 3_000));
      }
    }
  }

  private async handle(u: TgUpdate): Promise<void> {
    const text = u.message?.text?.trim();
    if (!text || !text.startsWith("/")) return;

    if (!this.authorized(u)) {
      this.log.warn({ chat: u.message?.chat?.id, user: u.message?.from?.id }, "Ignored command from unauthorized sender");
      return;
    }

    // "/soak_set KEY=VAL" → cmd="/soak_set", args=["KEY=VAL"]; strip @botname.
    const [rawCmd, ...args] = text.split(/\s+/);
    const cmd = rawCmd.split("@")[0].toLowerCase();
    const handler = this.handlers.get(cmd);
    const reply = (t: string) => this.tg.notify(t);

    if (!handler) {
      reply(`Unknown command: <code>${cmd}</code>. Try /help`);
      return;
    }
    try {
      await handler(args, reply);
    } catch (err) {
      this.log.warn({ err, cmd }, "Command handler threw");
      reply(`⚠️ Command failed: ${err instanceof Error ? err.message : "error"}`);
    }
  }
}
