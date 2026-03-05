import type { Telegram } from "telegraf"

const EDIT_INTERVAL = 1500 // ms between edits
const MAX_MSG_LENGTH = 4000 // split before Telegram's 4096 limit

export class TelegramStreamSink {
  private chatId: number
  private telegram: Telegram
  private messageId: number | null = null
  private buffer = ""
  private lastEditAt = 0
  private editTimer: ReturnType<typeof setTimeout> | null = null
  private finished = false

  constructor(chatId: number, telegram: Telegram) {
    this.chatId = chatId
    this.telegram = telegram
  }

  /** Append a token/delta to the current message. */
  async push(delta: string): Promise<void> {
    this.buffer += delta

    // If current buffer exceeds limit, finalize this message and start a new one
    if (this.buffer.length > MAX_MSG_LENGTH && this.messageId !== null) {
      await this.flushEdit(true)
      this.messageId = null
      this.buffer = this.buffer.slice(MAX_MSG_LENGTH)
    }

    // Send initial message if we haven't yet
    if (this.messageId === null && this.buffer.length > 0) {
      await this.sendNew()
      return
    }

    // Throttled edit
    const now = Date.now()
    if (now - this.lastEditAt >= EDIT_INTERVAL) {
      await this.flushEdit(false)
    } else if (!this.editTimer) {
      this.editTimer = setTimeout(() => {
        this.editTimer = null
        if (!this.finished) {
          this.flushEdit(false).catch(() => {})
        }
      }, EDIT_INTERVAL - (now - this.lastEditAt))
    }
  }

  /** Finalize the current message with Markdown formatting. */
  async finish(): Promise<void> {
    this.finished = true
    if (this.editTimer) {
      clearTimeout(this.editTimer)
      this.editTimer = null
    }
    if (this.buffer && this.messageId === null) {
      await this.sendNew()
    }
    if (this.messageId !== null) {
      await this.flushEdit(true)
    }
  }

  /** Start a new Telegram message for a new tool iteration. */
  async newIteration(): Promise<void> {
    // Finalize previous message if any
    if (this.messageId !== null && this.buffer) {
      await this.flushEdit(true)
    }
    this.messageId = null
    this.buffer = ""
  }

  private async sendNew(): Promise<void> {
    try {
      const sent = await this.telegram.sendMessage(this.chatId, this.buffer)
      this.messageId = sent.message_id
      this.lastEditAt = Date.now()
    } catch {
      // If send fails, buffer stays — next push will retry
    }
  }

  private async flushEdit(final: boolean): Promise<void> {
    if (this.messageId === null || !this.buffer) return

    try {
      if (final) {
        // Final edit: try Markdown
        try {
          await this.telegram.editMessageText(
            this.chatId,
            this.messageId,
            undefined,
            this.buffer,
            { parse_mode: "Markdown" }
          )
        } catch {
          // Markdown parse error — fall back to plain text
          await this.telegram.editMessageText(
            this.chatId,
            this.messageId,
            undefined,
            this.buffer
          )
        }
      } else {
        // Intermediate edit: plain text only (avoids parse errors on partial markdown)
        await this.telegram.editMessageText(
          this.chatId,
          this.messageId,
          undefined,
          this.buffer
        )
      }
      this.lastEditAt = Date.now()
    } catch {
      // Edit can fail if message content hasn't changed — ignore
    }
  }
}
