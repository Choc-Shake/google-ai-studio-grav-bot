import { Context } from 'grammy';

/**
 * Continuously sends a "typing" chat action to keep the indicator alive
 * while the LLM processes. Telegram typing indicators expire after ~5 seconds,
 * so we resend every 4 seconds until stop() is called.
 */
export class TypingIndicator {
  private intervalId: NodeJS.Timeout | null = null;
  private ctx: Context;

  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  start() {
    // Send immediately, then every 4 seconds
    this.ctx.replyWithChatAction('typing').catch(() => {});
    this.intervalId = setInterval(() => {
      this.ctx.replyWithChatAction('typing').catch(() => {});
    }, 4000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
