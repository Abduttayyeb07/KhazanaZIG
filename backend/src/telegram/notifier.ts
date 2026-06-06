import axios from "axios";
import type { Logger } from "@zig/logger";

export class TelegramNotifier {
  private readonly token: string;
  private readonly chatId: string;
  private readonly log: Logger;
  private readonly enabled: boolean;

  constructor(token: string, chatId: string, log: Logger) {
    this.token = token;
    this.chatId = chatId;
    this.log = log.child({ module: "telegram" });
    this.enabled = token.length > 0 && chatId.length > 0;

    if (!this.enabled) {
      this.log.warn("Telegram not configured — notifications disabled");
    }
  }

  async send(text: string): Promise<void> {
    if (!this.enabled) return;

    try {
      await axios.post(
        `https://api.telegram.org/bot${this.token}/sendMessage`,
        { chat_id: this.chatId, text, parse_mode: "HTML" },
        { timeout: 5_000 }
      );
    } catch (err) {
      this.log.warn({ err }, "Telegram send failed");
    }
  }

  // Fire-and-forget — never throws, never blocks execution
  notify(text: string): void {
    this.send(text).catch(() => undefined);
  }
}
