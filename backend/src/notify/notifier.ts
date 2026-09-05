import type { Logger } from "@zig/logger";

// ── Operational notifier ────────────────────────────────────────────────────────
//
// Replaces the Telegram feed. Everything the soak used to announce over Telegram
// now lands in the dashboard event log and the structured logs — one audience,
// one place to look, no external service in the operational path.
//
// The soak's messages were written for Telegram and carry HTML tags plus emoji
// section markers. Rather than rewrite every call site, this strips the markup so
// the same text renders cleanly in the dashboard feed.
// ──────────────────────────────────────────────────────────────────────────────

export type NotifyLevel = "info" | "warn" | "error";

export interface EventSink {
  addEvent(level: NotifyLevel, msg: string): void;
}

export class Notifier {
  private readonly sink: EventSink;
  private readonly log: Logger;

  constructor(sink: EventSink, log: Logger) {
    this.sink = sink;
    this.log = log.child({ module: "notifier" });
  }

  notify(text: string): void {
    const clean = stripMarkup(text);
    if (clean.length === 0) return;
    this.sink.addEvent(levelFor(clean), clean);
    this.log.info({ msg: clean.slice(0, 400) }, "notify");
  }
}

// A no-op notifier for tests and the simulator, where nothing should be published.
export const silentNotifier: Pick<Notifier, "notify"> = { notify: () => undefined };

function stripMarkup(text: string): string {
  return text
    .replace(/<\/?(b|i|code|pre|u|s)>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Severity is inferred from the markers the soak already uses, so halts and risk
// events stay visually distinct in the dashboard feed.
function levelFor(text: string): NotifyLevel {
  if (/^🛑|RISK HALT|HALT/.test(text)) return "error";
  if (/^⚠️|^🧭|BREAKOUT|WARN/.test(text)) return "warn";
  return "info";
}
